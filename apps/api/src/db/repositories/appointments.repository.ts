import { Pool } from 'pg';
import { withTransaction } from '../transaction';
import { Appointment } from './rows';

const APPOINTMENT_COLUMNS = `id, tenant_id as "tenantId",
  patient_contact_id as "patientContactId", patient_id as "patientId",
  service_id as "serviceId", location_id as "locationId", resource_id as "resourceId",
  start_at as "startAt", end_at as "endAt", status, source,
  created_by as "createdBy", cancellation_reason as "cancellationReason",
  attendance_status as "attendanceStatus", confirmation_status as "confirmationStatus",
  google_event_id as "googleEventId", operation_id as "operationId",
  created_at as "createdAt", updated_at as "updatedAt"`;

export interface CreateAppointmentWithReservationsInput {
  tenantId: string;
  patientContactId: string;
  serviceId: string;
  locationId: string;
  resourceId: string | null;
  startAt: Date;
  endAt: Date;
  blockingStartAt: Date;
  blockingEndAt: Date;
  professionals: Array<{ id: string; role: 'primary' | 'assistant' | 'required' }>;
  operationId?: string | null;
  status?: 'BOOKING' | 'RESCHEDULE_PENDING';
}

export class AppointmentsRepository {
  constructor(private readonly pool: Pool) {}

  async createWithReservations(
    input: CreateAppointmentWithReservationsInput,
  ): Promise<Appointment> {
    return withTransaction(this.pool, async (client) => {
      const status = input.status ?? 'BOOKING';
      const reservationStatus =
        status === 'RESCHEDULE_PENDING' ? 'RESCHEDULE_PENDING' : 'BOOKED';

      const {
        rows: [appointment],
      } = await client.query(
        `insert into appointments
           (tenant_id, patient_contact_id, service_id, location_id, resource_id,
            start_at, end_at, status, operation_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning ${APPOINTMENT_COLUMNS}`,
        [
          input.tenantId,
          input.patientContactId,
          input.serviceId,
          input.locationId,
          input.resourceId,
          input.startAt,
          input.endAt,
          status,
          input.operationId ?? null,
        ],
      );

      for (const professional of input.professionals) {
        await client.query(
          `insert into appointment_professionals
             (tenant_id, appointment_id, professional_id, role)
           values ($1, $2, $3, $4)`,
          [input.tenantId, appointment.id, professional.id, professional.role],
        );

        await client.query(
          `insert into professional_reservations
             (tenant_id, appointment_id, professional_id, start_at, end_at, status)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            input.tenantId,
            appointment.id,
            professional.id,
            input.blockingStartAt,
            input.blockingEndAt,
            reservationStatus,
          ],
        );
      }

      if (input.resourceId) {
        await client.query(
          `insert into resource_reservations
             (tenant_id, appointment_id, resource_id, start_at, end_at, status)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            input.tenantId,
            appointment.id,
            input.resourceId,
            input.blockingStartAt,
            input.blockingEndAt,
            reservationStatus,
          ],
        );
      }

      return appointment;
    });
  }

  async findById(tenantId: string, appointmentId: string): Promise<Appointment | null> {
    const { rows } = await this.pool.query(
      `select ${APPOINTMENT_COLUMNS} from appointments
       where tenant_id = $1 and id = $2`,
      [tenantId, appointmentId],
    );
    return (rows[0] as Appointment | undefined) ?? null;
  }

  async findByContact(
    tenantId: string,
    patientContactId: string,
    from: Date,
  ): Promise<Appointment[]> {
    const { rows } = await this.pool.query(
      `select ${APPOINTMENT_COLUMNS} from appointments
       where tenant_id = $1 and patient_contact_id = $2
         and status in ('BOOKED', 'RESCHEDULE_PENDING') and start_at >= $3
       order by start_at`,
      [tenantId, patientContactId, from],
    );
    return rows as Appointment[];
  }

  async listProfessionalIds(tenantId: string, appointmentId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `select professional_id as "professionalId" from appointment_professionals
       where tenant_id = $1 and appointment_id = $2`,
      [tenantId, appointmentId],
    );
    return rows.map((row: { professionalId: string }) => row.professionalId);
  }

  async updateStatus(tenantId: string, appointmentId: string, status: string): Promise<void> {
    await this.pool.query(
      `update appointments set status = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, appointmentId, status],
    );
  }

  /** Every appointment that happened (or was scheduled) in the window. */
  async listInRange(tenantId: string, from: Date, to: Date): Promise<Appointment[]> {
    const { rows } = await this.pool.query(
      `select ${APPOINTMENT_COLUMNS}
       from appointments
       where tenant_id = $1
         and start_at >= $2 and start_at < $3
         and status <> 'BOOKING'
       order by start_at`,
      [tenantId, from, to],
    );
    return rows as Appointment[];
  }

  /** Attendance and confirmation counters for the pilot metrics. */
  async attendanceSummary(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<{
    scheduled: number;
    attended: number;
    noShow: number;
    lateCancelled: number;
    confirmed: number;
    unconfirmed: number;
    pending: number;
  }> {
    const { rows } = await this.pool.query(
      `select
         count(*)::int as scheduled,
         count(*) filter (where attendance_status = 'ATTENDED')::int as attended,
         count(*) filter (where attendance_status = 'NO_SHOW')::int as "noShow",
         count(*) filter (where attendance_status = 'LATE_CANCELLED')::int as "lateCancelled",
         count(*) filter (where confirmation_status = 'CONFIRMED')::int as confirmed,
         count(*) filter (where confirmation_status = 'DECLINED')::int as unconfirmed,
         count(*) filter (where confirmation_status = 'PENDING')::int as pending
       from appointments
       where tenant_id = $1
         and start_at >= $2 and start_at < $3
         and status <> 'BOOKING'`,
      [tenantId, from, to],
    );
    return rows[0];
  }

  /** Resolves a unique id prefix, so the operator can copy a short id. */
  async findByIdPrefix(tenantId: string, prefix: string): Promise<Appointment | null> {
    if (!/^[0-9a-f-]{4,36}$/i.test(prefix)) return null;
    const { rows } = await this.pool.query(
      `select ${APPOINTMENT_COLUMNS}
       from appointments
       where tenant_id = $1 and id::text like $2
       limit 2`,
      [tenantId, `${prefix.toLowerCase()}%`],
    );
    if (rows.length !== 1) return null;
    return rows[0] as Appointment;
  }

  async setCalendarEvent(
    tenantId: string,
    appointmentId: string,
    googleEventId: string,
  ): Promise<void> {
    await this.pool.query(
      `update appointments set google_event_id = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, appointmentId, googleEventId],
    );
  }

  async setAttendanceStatus(
    tenantId: string,
    appointmentId: string,
    attendanceStatus: string,
  ): Promise<void> {
    await this.pool.query(
      `update appointments set attendance_status = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, appointmentId, attendanceStatus],
    );
  }

  /** Upcoming appointments that were mirrored to an external calendar. */
  async listUpcomingWithEvent(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<Appointment[]> {
    const { rows } = await this.pool.query(
      `select ${APPOINTMENT_COLUMNS}
       from appointments
       where tenant_id = $1
         and status = 'BOOKED'
         and google_event_id is not null
         and start_at >= $2 and start_at <= $3
       order by start_at`,
      [tenantId, from, to],
    );
    return rows as Appointment[];
  }

  async setConfirmationStatus(
    tenantId: string,
    appointmentId: string,
    confirmationStatus: 'PENDING' | 'CONFIRMED' | 'DECLINED',
  ): Promise<void> {
    await this.pool.query(
      `update appointments set confirmation_status = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, appointmentId, confirmationStatus],
    );
  }

  /** Booked appointments starting in the window that still need this reminder. */
  async listNeedingReminder(
    tenantId: string,
    kind: '24H' | '48H',
    from: Date,
    to: Date,
  ): Promise<Appointment[]> {
    const { rows } = await this.pool.query(
      `select ${APPOINTMENT_COLUMNS}
       from appointments a
       where a.tenant_id = $1
         and a.status = 'BOOKED'
         and a.confirmation_status = 'PENDING'
         and a.start_at >= $3 and a.start_at <= $4
         and not exists (
           select 1 from appointment_reminders r
           where r.tenant_id = a.tenant_id
             and r.appointment_id = a.id
             and r.kind = $2
         )
       order by a.start_at`,
      [tenantId, kind, from, to],
    );
    return rows as Appointment[];
  }

  /** The nearest booked appointment of a contact still waiting for confirmation. */
  async findPendingConfirmation(
    tenantId: string,
    patientContactId: string,
    from: Date,
    to: Date,
  ): Promise<Appointment | null> {
    const { rows } = await this.pool.query(
      `select ${APPOINTMENT_COLUMNS}
       from appointments
       where tenant_id = $1 and patient_contact_id = $2
         and status = 'BOOKED' and confirmation_status = 'PENDING'
         and start_at >= $3 and start_at <= $4
       order by start_at
       limit 1`,
      [tenantId, patientContactId, from, to],
    );
    return (rows[0] as Appointment | undefined) ?? null;
  }

  async releaseReservations(tenantId: string, appointmentId: string): Promise<void> {
    await this.pool.query(
      `update professional_reservations set status = 'RELEASED'
       where tenant_id = $1 and appointment_id = $2 and status <> 'RELEASED'`,
      [tenantId, appointmentId],
    );
    await this.pool.query(
      `update resource_reservations set status = 'RELEASED'
       where tenant_id = $1 and appointment_id = $2 and status <> 'RELEASED'`,
      [tenantId, appointmentId],
    );
  }

  async confirmReservations(tenantId: string, appointmentId: string): Promise<void> {
    await this.pool.query(
      `update professional_reservations set status = 'BOOKED'
       where tenant_id = $1 and appointment_id = $2 and status = 'RESCHEDULE_PENDING'`,
      [tenantId, appointmentId],
    );
    await this.pool.query(
      `update resource_reservations set status = 'BOOKED'
       where tenant_id = $1 and appointment_id = $2 and status = 'RESCHEDULE_PENDING'`,
      [tenantId, appointmentId],
    );
  }
}
