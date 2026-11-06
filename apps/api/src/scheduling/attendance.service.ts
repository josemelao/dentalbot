import { DateTime } from 'luxon';
import { DomainError } from '../common/errors';
import { AuditRepository } from '../db/repositories/audit.repository';
import { AppointmentsRepository } from '../db/repositories/appointments.repository';
import { CatalogRepository } from '../db/repositories/catalog.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { Appointment } from '../db/repositories/rows';
import { formatPatientLabel } from '../pipeline/ticket-card';

export type AttendanceMark = 'ATTENDED' | 'NO_SHOW';

export interface DayRow {
  id: string;
  startAt: Date;
  serviceName: string;
  patientLabel: string;
  status: string;
  confirmationStatus: string;
  attendanceStatus: string;
}

export interface AttendanceSummary {
  scheduled: number;
  attended: number;
  noShow: number;
  lateCancelled: number;
  confirmed: number;
  unconfirmed: number;
  pending: number;
  noShowRate: number;
  confirmationRate: number;
}

export interface AttendanceDependencies {
  appointments: AppointmentsRepository;
  catalog: CatalogRepository;
  patients: PatientsRepository;
  audit: AuditRepository;
  now: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;

/**
 * The daily attendance closing.
 *
 * No-show is measured only over the appointments that were expected to happen:
 * a late cancellation is its own status and never counts as a no-show.
 */
export class AttendanceService {
  constructor(private readonly deps: AttendanceDependencies) {}

  async listDay(tenantId: string, dateISO: string): Promise<DayRow[]> {
    const timezone = await this.timezoneFor(tenantId);
    const day = DateTime.fromISO(dateISO, { zone: timezone }).startOf('day');
    if (!day.isValid) {
      throw new DomainError('INVALID_DATE', 400, 'date must be YYYY-MM-DD');
    }

    const appointments = await this.deps.appointments.listInRange(
      tenantId,
      day.toJSDate(),
      day.plus({ days: 1 }).toJSDate(),
    );

    const rows: DayRow[] = [];
    for (const appointment of appointments) {
      rows.push({
        id: appointment.id,
        startAt: appointment.startAt,
        serviceName: await this.serviceName(tenantId, appointment.serviceId),
        patientLabel: await this.patientLabel(tenantId, appointment.patientContactId),
        status: appointment.status,
        confirmationStatus: appointment.confirmationStatus,
        attendanceStatus: appointment.attendanceStatus,
      });
    }
    return rows;
  }

  async mark(
    tenantId: string,
    appointmentRef: string,
    mark: AttendanceMark,
  ): Promise<Appointment> {
    const appointment = UUID.test(appointmentRef)
      ? await this.deps.appointments.findById(tenantId, appointmentRef)
      : await this.deps.appointments.findByIdPrefix(tenantId, appointmentRef);

    if (!appointment) {
      throw new DomainError('APPOINTMENT_NOT_FOUND', 404, 'Appointment not found');
    }
    if (appointment.startAt.getTime() > this.deps.now().getTime()) {
      throw new DomainError(
        'APPOINTMENT_IN_FUTURE',
        409,
        'Cannot close attendance for a future appointment',
      );
    }
    if (appointment.status === 'CANCELLED' || appointment.status === 'RESCHEDULE_PENDING') {
      throw new DomainError(
        'APPOINTMENT_NOT_ATTENDABLE',
        409,
        'Cancelled or pending appointments have no attendance',
      );
    }

    await this.deps.appointments.setAttendanceStatus(tenantId, appointment.id, mark);
    await this.deps.appointments.updateStatus(
      tenantId,
      appointment.id,
      mark === 'ATTENDED' ? 'COMPLETED' : 'NO_SHOW',
    );
    await this.deps.audit.append({
      tenantId,
      actorType: 'human',
      action: 'attendance_marked',
      entityType: 'appointment',
      entityId: appointment.id,
      metadata: { mark, previous: appointment.attendanceStatus },
    });

    return {
      ...appointment,
      attendanceStatus: mark,
      status: mark === 'ATTENDED' ? 'COMPLETED' : 'NO_SHOW',
    };
  }

  async summary(tenantId: string, fromISO: string, toISO: string): Promise<AttendanceSummary> {
    const timezone = await this.timezoneFor(tenantId);
    const from = DateTime.fromISO(fromISO, { zone: timezone }).startOf('day');
    const to = DateTime.fromISO(toISO, { zone: timezone }).startOf('day').plus({ days: 1 });
    if (!from.isValid || !to.isValid) {
      throw new DomainError('INVALID_DATE', 400, 'dates must be YYYY-MM-DD');
    }

    const counts = await this.deps.appointments.attendanceSummary(
      tenantId,
      from.toJSDate(),
      to.toJSDate(),
    );

    return {
      ...counts,
      noShowRate: rate(counts.noShow, counts.attended + counts.noShow),
      confirmationRate: rate(counts.confirmed, counts.scheduled),
    };
  }

  async timezoneFor(tenantId: string): Promise<string> {
    const locations = await this.deps.catalog.listActiveLocations(tenantId);
    return locations[0]?.timezone ?? 'America/Sao_Paulo';
  }

  private async serviceName(tenantId: string, serviceId: string): Promise<string> {
    const service = await this.deps.catalog.findService(tenantId, serviceId);
    return service?.name ?? 'Consulta';
  }

  private async patientLabel(tenantId: string, contactId: string): Promise<string> {
    const contact = await this.deps.patients.findContactById(tenantId, contactId);
    return formatPatientLabel(contact?.displayName, contact?.externalUserId ?? '');
  }
}
