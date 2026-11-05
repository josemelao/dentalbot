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

  async updateStatus(tenantId: string, appointmentId: string, status: string): Promise<void> {
    await this.pool.query(
      `update appointments set status = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, appointmentId, status],
    );
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
