import { CalendarAdapter } from '../calendar/calendar-adapter';
import { DomainError } from '../common/errors';
import { AppointmentsRepository } from '../db/repositories/appointments.repository';
import { CatalogRepository } from '../db/repositories/catalog.repository';
import { LocksRepository } from '../db/repositories/locks.repository';
import { OperationsRepository } from '../db/repositories/operations.repository';
import { Appointment, AvailabilityLock } from '../db/repositories/rows';
import { AvailabilityService } from './availability.service';
import { Slot } from './types';

export interface BookInput {
  tenantId: string;
  conversationId: string;
  patientContactId: string;
  serviceId: string;
  quantity: number;
  professionalIds: string[];
  locationId: string;
  resourceId: string | null;
  startAt: Date;
  idempotencyKey: string;
}

export interface RescheduleInput {
  tenantId: string;
  appointmentId: string;
  newStartAt: Date;
  professionalIds: string[];
  idempotencyKey: string;
}

export interface CancelInput {
  tenantId: string;
  appointmentId: string;
  idempotencyKey: string;
  reason?: string;
  now?: Date;
}

export type CancelOutcome =
  | { status: 'CANCELLED'; appointment: Appointment }
  | { status: 'UNKNOWN'; appointmentId: string; operationId: string };

export type BookingOutcome =
  | { status: 'BOOKED'; appointment: Appointment }
  | { status: 'CONFLICT'; alternatives: Slot[] }
  | { status: 'UNKNOWN'; appointmentId: string; operationId: string };

export interface BookingDependencies {
  catalog: CatalogRepository;
  availability: AvailabilityService;
  appointments: AppointmentsRepository;
  operations: OperationsRepository;
  locks: LocksRepository;
  calendar: CalendarAdapter;
  now: () => Date;
}

const sameProfessionalSet = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((id) => right.includes(id));

const isConflict = (error: unknown): boolean => {
  const code = (error as { code?: string }).code;
  return code === '23P01' || code === '23505';
};

export class BookingService {
  constructor(private readonly deps: BookingDependencies) {}

  async book(input: BookInput): Promise<BookingOutcome> {
    const operationResult = await this.deps.operations.createOrGet({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      operationType: 'BOOK',
      requestPayload: {
        serviceId: input.serviceId,
        professionalIds: input.professionalIds,
        startAt: input.startAt.toISOString(),
      },
    });
    const operation = operationResult.operation;

    if (!operationResult.created && operation.status === 'COMPLETED') {
      const appointmentId = (operation.resultPayload as { appointmentId?: string }).appointmentId;
      if (appointmentId) {
        const appointment = await this.deps.appointments.findById(
          input.tenantId,
          appointmentId,
        );
        if (appointment) return { status: 'BOOKED', appointment };
      }
    }

    if (!operationResult.created && operation.status === 'UNKNOWN') {
      const appointmentId = (operation.resultPayload as { appointmentId?: string }).appointmentId;
      if (appointmentId) {
        return { status: 'UNKNOWN', appointmentId, operationId: operation.id };
      }
    }

    const service = await this.deps.catalog.findService(input.tenantId, input.serviceId);
    if (!service) {
      throw new DomainError('SERVICE_NOT_FOUND', 404, 'Service not found');
    }

    const variant = await this.deps.catalog.findVariant(
      input.tenantId,
      input.serviceId,
      input.quantity,
    );
    const durationMinutes = variant?.durationMinutes ?? service.durationMinutes;
    const endAt = new Date(input.startAt.getTime() + durationMinutes * 60_000);
    const blockingStartAt = new Date(
      input.startAt.getTime() - service.bufferBeforeMinutes * 60_000,
    );
    const blockingEndAt = new Date(
      endAt.getTime() + service.bufferAfterMinutes * 60_000,
    );

    const slots = await this.deps.availability.findSlots({
      tenantId: input.tenantId,
      serviceId: input.serviceId,
      quantity: input.quantity,
      professionalId: input.professionalIds.length === 1 ? input.professionalIds[0] : null,
      locationId: input.locationId,
      from: new Date(input.startAt.getTime() - 12 * 60 * 60_000),
      to: new Date(input.startAt.getTime() + 12 * 60 * 60_000),
      now: this.deps.now(),
    });

    const match = slots.find(
      (slot) =>
        slot.startAt.getTime() === input.startAt.getTime() &&
        sameProfessionalSet(slot.professionalIds, input.professionalIds),
    );

    if (!match) {
      await this.deps.operations.mark(input.tenantId, operation.id, 'FAILED', {
        reason: 'CONFLICT',
      });
      return { status: 'CONFLICT', alternatives: slots.slice(0, 3) };
    }

    const locks: AvailabilityLock[] = [];
    try {
      for (const professionalId of input.professionalIds) {
        locks.push(
          await this.deps.locks.create({
            tenantId: input.tenantId,
            professionalId,
            startAt: blockingStartAt,
            endAt: blockingEndAt,
            expiresAt: new Date(this.deps.now().getTime() + 5 * 60_000),
            operationId: operation.id,
          }),
        );
      }
    } catch (error) {
      await this.releaseLocks(input.tenantId, locks);
      await this.deps.operations.mark(input.tenantId, operation.id, 'FAILED', {
        reason: 'LOCK_ERROR',
      });
      throw error;
    }

    let appointment: Appointment;
    try {
      appointment = await this.deps.appointments.createWithReservations({
        tenantId: input.tenantId,
        patientContactId: input.patientContactId,
        serviceId: input.serviceId,
        locationId: input.locationId,
        resourceId: input.resourceId,
        startAt: input.startAt,
        endAt,
        blockingStartAt,
        blockingEndAt,
        professionals: input.professionalIds.map((id, index) => ({
          id,
          role: index === 0 ? ('primary' as const) : ('required' as const),
        })),
        operationId: operation.id,
        status: 'BOOKING',
      });
    } catch (error) {
      await this.releaseLocks(input.tenantId, locks);
      if (isConflict(error)) {
        await this.deps.operations.mark(input.tenantId, operation.id, 'FAILED', {
          reason: 'CONFLICT',
        });
        return { status: 'CONFLICT', alternatives: slots.slice(0, 3) };
      }
      await this.deps.operations.mark(input.tenantId, operation.id, 'FAILED', {
        reason: 'DB_ERROR',
      });
      throw error;
    }

    try {
      const created = await this.deps.calendar.createEvent({
        operationId: operation.id,
        tenantId: input.tenantId,
        summary: service.name,
        startAt: input.startAt,
        endAt,
        professionalId: input.professionalIds[0],
      });

      const lookup = await this.deps.calendar.getEvent(created.externalEventId);
      if (!lookup.exists) {
        throw new Error('Calendar event was not found after creation');
      }

      await this.deps.appointments.setCalendarEvent(
        input.tenantId,
        appointment.id,
        created.externalEventId,
      );
      await this.deps.appointments.updateStatus(input.tenantId, appointment.id, 'BOOKED');
      await this.deps.operations.mark(
        input.tenantId,
        operation.id,
        'COMPLETED',
        { appointmentId: appointment.id },
        created.externalEventId,
      );
      await this.releaseLocks(input.tenantId, locks);

      return {
        status: 'BOOKED',
        appointment: {
          ...appointment,
          status: 'BOOKED',
          googleEventId: created.externalEventId,
        },
      };
    } catch {
      await this.deps.appointments.updateStatus(input.tenantId, appointment.id, 'UNKNOWN');
      await this.deps.operations.mark(input.tenantId, operation.id, 'UNKNOWN', {
        appointmentId: appointment.id,
      });
      await this.releaseLocks(input.tenantId, locks);
      return {
        status: 'UNKNOWN',
        appointmentId: appointment.id,
        operationId: operation.id,
      };
    }
  }

  async reschedule(input: RescheduleInput): Promise<BookingOutcome> {
    const old = await this.deps.appointments.findById(input.tenantId, input.appointmentId);
    if (!old) {
      throw new DomainError('APPOINTMENT_NOT_FOUND', 404, 'Appointment not found');
    }
    if (old.status !== 'BOOKED') {
      throw new DomainError('APPOINTMENT_NOT_BOOKED', 409, 'Appointment is not booked');
    }

    const operationResult = await this.deps.operations.createOrGet({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      operationType: 'RESCHEDULE',
      requestPayload: {
        appointmentId: old.id,
        newStartAt: input.newStartAt.toISOString(),
      },
    });
    const operation = operationResult.operation;

    if (!operationResult.created && operation.status === 'COMPLETED') {
      const newAppointmentId = (operation.resultPayload as { newAppointmentId?: string })
        .newAppointmentId;
      if (newAppointmentId) {
        const appointment = await this.deps.appointments.findById(
          input.tenantId,
          newAppointmentId,
        );
        if (appointment) return { status: 'BOOKED', appointment };
      }
    }
    if (!operationResult.created && operation.status === 'UNKNOWN') {
      const newAppointmentId = (operation.resultPayload as { newAppointmentId?: string })
        .newAppointmentId;
      if (newAppointmentId) {
        return {
          status: 'UNKNOWN',
          appointmentId: newAppointmentId,
          operationId: operation.id,
        };
      }
    }

    const service = await this.deps.catalog.findService(input.tenantId, old.serviceId);
    if (!service) {
      throw new DomainError('SERVICE_NOT_FOUND', 404, 'Service not found');
    }

    const durationMinutes = service.durationMinutes;
    const newEndAt = new Date(input.newStartAt.getTime() + durationMinutes * 60_000);
    const blockingStartAt = new Date(
      input.newStartAt.getTime() - service.bufferBeforeMinutes * 60_000,
    );
    const blockingEndAt = new Date(
      newEndAt.getTime() + service.bufferAfterMinutes * 60_000,
    );

    const slots = await this.deps.availability.findSlots({
      tenantId: input.tenantId,
      serviceId: old.serviceId,
      quantity: 1,
      professionalId: input.professionalIds.length === 1 ? input.professionalIds[0] : null,
      locationId: old.locationId,
      from: new Date(input.newStartAt.getTime() - 12 * 60 * 60_000),
      to: new Date(input.newStartAt.getTime() + 12 * 60 * 60_000),
      now: this.deps.now(),
    });

    const match = slots.find(
      (slot) =>
        slot.startAt.getTime() === input.newStartAt.getTime() &&
        sameProfessionalSet(slot.professionalIds, input.professionalIds),
    );
    if (!match) {
      await this.deps.operations.mark(input.tenantId, operation.id, 'FAILED', {
        reason: 'CONFLICT',
      });
      return { status: 'CONFLICT', alternatives: slots.slice(0, 3) };
    }

    const locks: AvailabilityLock[] = [];
    try {
      for (const professionalId of input.professionalIds) {
        locks.push(
          await this.deps.locks.create({
            tenantId: input.tenantId,
            professionalId,
            startAt: blockingStartAt,
            endAt: blockingEndAt,
            expiresAt: new Date(this.deps.now().getTime() + 5 * 60_000),
            operationId: operation.id,
          }),
        );
      }
    } catch (error) {
      await this.releaseLocks(input.tenantId, locks);
      await this.deps.operations.mark(input.tenantId, operation.id, 'FAILED', {
        reason: 'LOCK_ERROR',
      });
      throw error;
    }

    let newAppointment: Appointment;
    try {
      newAppointment = await this.deps.appointments.createWithReservations({
        tenantId: input.tenantId,
        patientContactId: old.patientContactId,
        serviceId: old.serviceId,
        locationId: old.locationId,
        resourceId: old.resourceId,
        startAt: input.newStartAt,
        endAt: newEndAt,
        blockingStartAt,
        blockingEndAt,
        professionals: input.professionalIds.map((id, index) => ({
          id,
          role: index === 0 ? ('primary' as const) : ('required' as const),
        })),
        operationId: operation.id,
        status: 'RESCHEDULE_PENDING',
      });
    } catch (error) {
      await this.releaseLocks(input.tenantId, locks);
      if (isConflict(error)) {
        await this.deps.operations.mark(input.tenantId, operation.id, 'FAILED', {
          reason: 'CONFLICT',
        });
        return { status: 'CONFLICT', alternatives: slots.slice(0, 3) };
      }
      await this.deps.operations.mark(input.tenantId, operation.id, 'FAILED', {
        reason: 'DB_ERROR',
      });
      throw error;
    }

    let newEventId: string;
    try {
      const created = await this.deps.calendar.createEvent({
        operationId: operation.id,
        tenantId: input.tenantId,
        summary: service.name,
        startAt: input.newStartAt,
        endAt: newEndAt,
        professionalId: input.professionalIds[0],
      });
      const lookup = await this.deps.calendar.getEvent(created.externalEventId);
      if (!lookup.exists) {
        throw new Error('New calendar event was not found after creation');
      }
      newEventId = created.externalEventId;
    } catch {
      await this.deps.appointments.updateStatus(
        input.tenantId,
        newAppointment.id,
        'CANCELLED',
      );
      await this.deps.appointments.releaseReservations(input.tenantId, newAppointment.id);
      await this.deps.operations.mark(input.tenantId, operation.id, 'UNKNOWN', {
        oldAppointmentId: old.id,
        newAppointmentId: newAppointment.id,
      });
      await this.releaseLocks(input.tenantId, locks);
      return {
        status: 'UNKNOWN',
        appointmentId: newAppointment.id,
        operationId: operation.id,
      };
    }

    try {
      if (old.googleEventId) {
        await this.deps.calendar.cancelEvent(old.googleEventId);
        const oldLookup = await this.deps.calendar.getEvent(old.googleEventId);
        if (oldLookup.exists) {
          throw new Error('Old calendar event still exists');
        }
      }
    } catch {
      await this.deps.appointments.updateStatus(input.tenantId, newAppointment.id, 'BOOKED');
      await this.deps.appointments.confirmReservations(input.tenantId, newAppointment.id);
      await this.deps.appointments.setCalendarEvent(
        input.tenantId,
        newAppointment.id,
        newEventId,
      );
      await this.deps.operations.mark(input.tenantId, operation.id, 'UNKNOWN', {
        oldAppointmentId: old.id,
        newAppointmentId: newAppointment.id,
      });
      await this.releaseLocks(input.tenantId, locks);
      return {
        status: 'UNKNOWN',
        appointmentId: newAppointment.id,
        operationId: operation.id,
      };
    }

    await this.deps.appointments.updateStatus(input.tenantId, old.id, 'CANCELLED');
    await this.deps.appointments.releaseReservations(input.tenantId, old.id);
    await this.deps.appointments.updateStatus(input.tenantId, newAppointment.id, 'BOOKED');
    await this.deps.appointments.confirmReservations(input.tenantId, newAppointment.id);
    await this.deps.appointments.setCalendarEvent(
      input.tenantId,
      newAppointment.id,
      newEventId,
    );
    await this.deps.operations.mark(
      input.tenantId,
      operation.id,
      'COMPLETED',
      { oldAppointmentId: old.id, newAppointmentId: newAppointment.id },
      newEventId,
    );
    await this.releaseLocks(input.tenantId, locks);

    return {
      status: 'BOOKED',
      appointment: {
        ...newAppointment,
        status: 'BOOKED',
        googleEventId: newEventId,
      },
    };
  }

  async cancel(input: CancelInput): Promise<CancelOutcome> {
    const appointment = await this.deps.appointments.findById(
      input.tenantId,
      input.appointmentId,
    );
    if (!appointment) {
      throw new DomainError('APPOINTMENT_NOT_FOUND', 404, 'Appointment not found');
    }
    if (appointment.status === 'CANCELLED') {
      return { status: 'CANCELLED', appointment };
    }
    if (appointment.status !== 'BOOKED' && appointment.status !== 'RESCHEDULE_PENDING') {
      throw new DomainError(
        'APPOINTMENT_NOT_CANCELLABLE',
        409,
        'Appointment cannot be cancelled',
      );
    }

    const operationResult = await this.deps.operations.createOrGet({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      operationType: 'CANCEL',
      requestPayload: {
        appointmentId: appointment.id,
        reason: input.reason ?? null,
      },
    });
    const operation = operationResult.operation;

    if (!operationResult.created && operation.status === 'COMPLETED') {
      const current = await this.deps.appointments.findById(
        input.tenantId,
        input.appointmentId,
      );
      if (current) return { status: 'CANCELLED', appointment: current };
    }
    if (!operationResult.created && operation.status === 'UNKNOWN') {
      return {
        status: 'UNKNOWN',
        appointmentId: input.appointmentId,
        operationId: operation.id,
      };
    }

    const now = input.now ?? this.deps.now();
    const late = now.getTime() >= appointment.startAt.getTime() - 24 * 60 * 60_000;

    try {
      if (appointment.googleEventId) {
        await this.deps.calendar.cancelEvent(appointment.googleEventId);
        const lookup = await this.deps.calendar.getEvent(appointment.googleEventId);
        if (lookup.exists) {
          throw new Error('Calendar event still exists after cancellation');
        }
      }
    } catch {
      await this.deps.appointments.updateStatus(
        input.tenantId,
        appointment.id,
        'UNKNOWN',
      );
      await this.deps.operations.mark(input.tenantId, operation.id, 'UNKNOWN', {
        appointmentId: appointment.id,
      });
      return {
        status: 'UNKNOWN',
        appointmentId: appointment.id,
        operationId: operation.id,
      };
    }

    await this.deps.appointments.updateStatus(input.tenantId, appointment.id, 'CANCELLED');
    await this.deps.appointments.setAttendanceStatus(
      input.tenantId,
      appointment.id,
      late ? 'LATE_CANCELLED' : appointment.attendanceStatus,
    );
    await this.deps.appointments.releaseReservations(input.tenantId, appointment.id);
    await this.deps.operations.mark(input.tenantId, operation.id, 'COMPLETED', {
      appointmentId: appointment.id,
    });

    return {
      status: 'CANCELLED',
      appointment: {
        ...appointment,
        status: 'CANCELLED',
        attendanceStatus: late ? 'LATE_CANCELLED' : appointment.attendanceStatus,
      },
    };
  }

  private async releaseLocks(
    tenantId: string,
    locks: AvailabilityLock[],
  ): Promise<void> {
    for (const lock of locks) {
      await this.deps.locks.release(tenantId, lock.id);
    }
  }
}
