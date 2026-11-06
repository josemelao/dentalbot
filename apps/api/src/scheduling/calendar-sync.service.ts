import { CalendarAdapter } from '../calendar/calendar-adapter';
import { AppointmentsRepository } from '../db/repositories/appointments.repository';
import { AuditRepository } from '../db/repositories/audit.repository';
import { EscalationService } from '../pipeline/escalation.service';

export interface CalendarSyncDependencies {
  appointments: AppointmentsRepository;
  escalation: EscalationService;
  audit: AuditRepository;
  calendar: CalendarAdapter;
  now: () => Date;
  horizonDays: number;
}

export interface CalendarSyncResult {
  tenantId: string;
  checked: number;
  missing: number;
  moved: number;
}

/**
 * Detects appointments the clinic removed or moved directly in Google.
 *
 * The appointment is never cancelled silently: it becomes RESCHEDULE_REQUIRED,
 * the slot is released and the owners are warned. Talking to the patient is a
 * human decision, because a deletion can be a misclick.
 */
export class CalendarSyncService {
  constructor(private readonly deps: CalendarSyncDependencies) {}

  async syncTenant(tenantId: string): Promise<CalendarSyncResult> {
    const now = this.deps.now();
    const appointments = await this.deps.appointments.listUpcomingWithEvent(
      tenantId,
      now,
      new Date(now.getTime() + this.deps.horizonDays * 86_400_000),
    );

    let missing = 0;
    let moved = 0;

    for (const appointment of appointments) {
      const lookup = await this.deps.calendar.getEvent(appointment.googleEventId as string);

      const changed =
        !lookup.exists ||
        (lookup.startAt
          ? Math.abs(lookup.startAt.getTime() - appointment.startAt.getTime()) > 60_000
          : false);

      if (!changed) continue;

      if (!lookup.exists) missing += 1;
      else moved += 1;

      await this.deps.appointments.updateStatus(
        tenantId,
        appointment.id,
        'RESCHEDULE_REQUIRED',
      );
      await this.deps.appointments.releaseReservations(tenantId, appointment.id);
      await this.deps.audit.append({
        tenantId,
        actorType: 'system',
        action: 'calendar_external_change',
        entityType: 'appointment',
        entityId: appointment.id,
        metadata: { reason: lookup.exists ? 'MOVED' : 'DELETED' },
      });

      try {
        await this.deps.escalation.notifyCalendarChange({
          tenantId,
          patientContactId: appointment.patientContactId,
          when: appointment.startAt,
          reason: lookup.exists ? 'MOVED' : 'DELETED',
        });
      } catch {
        // The status change is what matters; the alert can be retried next run.
      }
    }

    return { tenantId, checked: appointments.length, missing, moved };
  }
}
