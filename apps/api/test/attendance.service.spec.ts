import { AuditRepository } from '../src/db/repositories/audit.repository';
import { AppointmentsRepository } from '../src/db/repositories/appointments.repository';
import { CatalogRepository } from '../src/db/repositories/catalog.repository';
import { PatientsRepository } from '../src/db/repositories/patients.repository';
import { AttendanceService } from '../src/scheduling/attendance.service';
import { getTestPool, seedClinic, seedScheduling } from './helpers/db';

const NOW = new Date('2026-11-10T15:00:00Z');

const build = (pool: any) =>
  new AttendanceService({
    appointments: new AppointmentsRepository(pool),
    catalog: new CatalogRepository(pool),
    patients: new PatientsRepository(pool),
    audit: new AuditRepository(pool),
    now: () => NOW,
  });

interface Seeded {
  tenantId: string;
  contactId?: string;
}

const addAppointment = async (
  pool: any,
  clinic: Seeded,
  scheduling: any,
  startAt: Date,
  options: { status?: string; attendance?: string; confirmation?: string } = {},
): Promise<string> => {
  const { rows } = await pool.query(
    `insert into appointments
       (tenant_id, patient_contact_id, service_id, location_id, start_at, end_at,
        status, attendance_status, confirmation_status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      clinic.tenantId,
      clinic.contactId,
      scheduling.cleaningServiceId,
      scheduling.locationId,
      startAt,
      new Date(startAt.getTime() + 40 * 60_000),
      options.status ?? 'BOOKED',
      options.attendance ?? 'PENDING',
      options.confirmation ?? 'PENDING',
    ],
  );
  return rows[0].id as string;
};

const setup = async () => {
  const pool = getTestPool();
  const clinic = await seedClinic(pool, { withConversation: true });
  const scheduling = await seedScheduling(pool, clinic.tenantId);
  return { pool, clinic, scheduling };
};

describe('AttendanceService', () => {
  it('lists the day with patient, service and status', async () => {
    const { pool, clinic, scheduling } = await setup();
    await addAppointment(pool, clinic, scheduling, new Date('2026-11-09T13:00:00Z'));

    const rows = await build(pool).listDay(clinic.tenantId, '2026-11-09');

    expect(rows).toHaveLength(1);
    expect(rows[0].serviceName).toBe('Limpeza');
    expect(rows[0].patientLabel).toBe('Maria');
    expect(rows[0].status).toBe('BOOKED');
    expect(rows[0].attendanceStatus).toBe('PENDING');
  });

  it('marks an appointment as attended', async () => {
    const { pool, clinic, scheduling } = await setup();
    const id = await addAppointment(pool, clinic, scheduling, new Date('2026-11-09T13:00:00Z'));

    const result = await build(pool).mark(clinic.tenantId, id, 'ATTENDED');

    expect(result.attendanceStatus).toBe('ATTENDED');
    expect(result.status).toBe('COMPLETED');

    const row = await pool.query(
      `select status, attendance_status from appointments where id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ status: 'COMPLETED', attendance_status: 'ATTENDED' });
  });

  it('marks an appointment as a no-show', async () => {
    const { pool, clinic, scheduling } = await setup();
    const id = await addAppointment(pool, clinic, scheduling, new Date('2026-11-09T13:00:00Z'));

    await build(pool).mark(clinic.tenantId, id, 'NO_SHOW');

    const row = await pool.query(
      `select status, attendance_status from appointments where id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ status: 'NO_SHOW', attendance_status: 'NO_SHOW' });
  });

  it('resolves a short id prefix', async () => {
    const { pool, clinic, scheduling } = await setup();
    const id = await addAppointment(pool, clinic, scheduling, new Date('2026-11-09T13:00:00Z'));

    const result = await build(pool).mark(clinic.tenantId, id.slice(0, 8), 'ATTENDED');
    expect(result.id).toBe(id);
  });

  it('refuses to close a future appointment', async () => {
    const { pool, clinic, scheduling } = await setup();
    const id = await addAppointment(pool, clinic, scheduling, new Date('2026-11-11T13:00:00Z'));

    await expect(build(pool).mark(clinic.tenantId, id, 'NO_SHOW')).rejects.toThrow(
      /future appointment/,
    );
  });

  it('refuses to close a cancelled appointment', async () => {
    const { pool, clinic, scheduling } = await setup();
    const id = await addAppointment(pool, clinic, scheduling, new Date('2026-11-09T13:00:00Z'), {
      status: 'CANCELLED',
      attendance: 'LATE_CANCELLED',
    });

    await expect(build(pool).mark(clinic.tenantId, id, 'NO_SHOW')).rejects.toThrow(
      /no attendance/,
    );
  });

  it('summarises the period without counting late cancellations as no-show', async () => {
    const { pool, clinic, scheduling } = await setup();
    await addAppointment(pool, clinic, scheduling, new Date('2026-11-09T13:00:00Z'), {
      attendance: 'ATTENDED',
      status: 'COMPLETED',
      confirmation: 'CONFIRMED',
    });
    await addAppointment(pool, clinic, scheduling, new Date('2026-11-09T14:00:00Z'), {
      attendance: 'NO_SHOW',
      status: 'NO_SHOW',
    });
    await addAppointment(pool, clinic, scheduling, new Date('2026-11-09T15:00:00Z'), {
      attendance: 'LATE_CANCELLED',
      status: 'CANCELLED',
    });
    await addAppointment(pool, clinic, scheduling, new Date('2026-11-09T16:00:00Z'));

    const summary = await build(pool).summary(
      clinic.tenantId,
      '2026-11-09',
      '2026-11-09',
    );

    expect(summary).toMatchObject({
      scheduled: 4,
      attended: 1,
      noShow: 1,
      lateCancelled: 1,
      confirmed: 1,
      pending: 3,
    });
    expect(summary.noShowRate).toBe(50);
    expect(summary.confirmationRate).toBe(25);
  });
});
