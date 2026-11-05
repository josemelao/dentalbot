import { CalendarAdapter } from '../calendar/calendar-adapter';
import { AppointmentsRepository } from '../db/repositories/appointments.repository';
import { LocksRepository } from '../db/repositories/locks.repository';
import { OperationsRepository } from '../db/repositories/operations.repository';

export interface ReconciliationDependencies {
  operations: OperationsRepository;
  appointments: AppointmentsRepository;
  locks: LocksRepository;
  calendar: CalendarAdapter;
}

export class ReconciliationService {
  constructor(private readonly deps: ReconciliationDependencies) {}

  async reconcileUnknown(tenantId: string): Promise<{ confirmed: number; failed: number }> {
    const unknown = await this.deps.operations.listUnknown(tenantId);
    let confirmed = 0;
    let failed = 0;

    for (const operation of unknown) {
      if (operation.operationType !== 'BOOK') continue;

      const appointmentId = (operation.resultPayload as { appointmentId?: string })
        .appointmentId;
      if (!appointmentId) {
        await this.deps.operations.mark(tenantId, operation.id, 'FAILED');
        failed += 1;
        continue;
      }

      const eventId = this.deps.calendar.eventIdFor(operation.id);
      const lookup = await this.deps.calendar.getEvent(eventId);

      if (lookup.exists) {
        await this.deps.appointments.updateStatus(tenantId, appointmentId, 'BOOKED');
        await this.deps.appointments.setCalendarEvent(tenantId, appointmentId, eventId);
        await this.deps.operations.mark(
          tenantId,
          operation.id,
          'COMPLETED',
          { appointmentId },
          eventId,
        );
        confirmed += 1;
      } else {
        await this.deps.appointments.updateStatus(tenantId, appointmentId, 'CANCELLED');
        await this.deps.appointments.releaseReservations(tenantId, appointmentId);
        await this.deps.operations.mark(tenantId, operation.id, 'FAILED', { appointmentId });
        failed += 1;
      }
    }

    return { confirmed, failed };
  }

  async releaseExpiredLocks(now: Date): Promise<number> {
    return this.deps.locks.releaseExpired(now);
  }
}
