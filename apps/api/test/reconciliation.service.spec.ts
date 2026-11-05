import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { buildBookingService, bookingInput } from './helpers/booking';
import { AppointmentsRepository } from '../src/db/repositories/appointments.repository';
import { LocksRepository } from '../src/db/repositories/locks.repository';
import { OperationsRepository } from '../src/db/repositories/operations.repository';
import { ReconciliationService } from '../src/scheduling/reconciliation.service';
import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';

const buildReconciliation = (pool: any, calendar: FakeCalendarAdapter) =>
  new ReconciliationService({
    operations: new OperationsRepository(pool),
    appointments: new AppointmentsRepository(pool),
    locks: new LocksRepository(pool),
    calendar,
  });

describe('ReconciliationService reschedule and cancel', () => {
  it('cancels the old event after a reschedule whose old cancellation failed', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    const service = buildBookingService(pool, calendar);

    const old = await service.book(bookingInput(clinic, s, { idempotencyKey: 'old' }));
    if (old.status !== 'BOOKED') throw new Error('setup failed');

    calendar.failNextCancel = new Error('cancel down');
    const result = await service.reschedule({
      tenantId: clinic.tenantId,
      appointmentId: old.appointment.id,
      newStartAt: new Date('2026-11-09T13:15:00Z'),
      professionalIds: [s.caioId],
      idempotencyKey: 'resched-unknown',
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status !== 'UNKNOWN') return;

    const summary = await buildReconciliation(pool, calendar).reconcileUnknown(
      clinic.tenantId,
    );
    expect(summary.confirmed).toBe(1);

    const oldRow = await pool.query(`select status from appointments where id = $1`, [
      old.appointment.id,
    ]);
    expect(oldRow.rows[0].status).toBe('CANCELLED');
    const newRow = await pool.query(`select status from appointments where id = $1`, [
      result.appointmentId,
    ]);
    expect(newRow.rows[0].status).toBe('BOOKED');
  });

  it('keeps the old appointment when the new reschedule event was never created', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    const service = buildBookingService(pool, calendar);

    const old = await service.book(bookingInput(clinic, s, { idempotencyKey: 'old' }));
    if (old.status !== 'BOOKED') throw new Error('setup failed');

    calendar.failNextCreate = new Error('calendar down');
    const result = await service.reschedule({
      tenantId: clinic.tenantId,
      appointmentId: old.appointment.id,
      newStartAt: new Date('2026-11-09T13:15:00Z'),
      professionalIds: [s.caioId],
      idempotencyKey: 'resched-failed',
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status !== 'UNKNOWN') return;

    const summary = await buildReconciliation(pool, calendar).reconcileUnknown(
      clinic.tenantId,
    );
    expect(summary.failed).toBe(1);

    const oldRow = await pool.query(`select status from appointments where id = $1`, [
      old.appointment.id,
    ]);
    expect(oldRow.rows[0].status).toBe('BOOKED');
    const newRow = await pool.query(`select status from appointments where id = $1`, [
      result.appointmentId,
    ]);
    expect(newRow.rows[0].status).toBe('CANCELLED');
  });

  it('keeps the new reservation blocking while a reschedule event is UNKNOWN', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    const service = buildBookingService(pool, calendar);

    const old = await service.book(bookingInput(clinic, s, { idempotencyKey: 'old' }));
    if (old.status !== 'BOOKED') throw new Error('setup failed');

    calendar.createThenThrow = new Error('ETIMEDOUT');
    const result = await service.reschedule({
      tenantId: clinic.tenantId,
      appointmentId: old.appointment.id,
      newStartAt: new Date('2026-11-09T13:15:00Z'),
      professionalIds: [s.caioId],
      idempotencyKey: 'resched-timeout',
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status !== 'UNKNOWN') return;

    const blocking = await pool.query(
      `select status from professional_reservations where appointment_id = $1`,
      [result.appointmentId],
    );
    expect(blocking.rows).toEqual([{ status: 'RESCHEDULE_PENDING' }]);

    const competing = await service.book(
      bookingInput(clinic, s, {
        idempotencyKey: 'compete',
        startAt: new Date('2026-11-09T13:15:00Z'),
      }),
    );
    expect(competing.status).toBe('CONFLICT');

    const summary = await buildReconciliation(pool, calendar).reconcileUnknown(
      clinic.tenantId,
    );
    expect(summary.confirmed).toBe(1);

    const bookedRow = await pool.query(`select status from appointments where id = $1`, [
      result.appointmentId,
    ]);
    expect(bookedRow.rows[0].status).toBe('BOOKED');
    const confirmedReservation = await pool.query(
      `select status from professional_reservations where appointment_id = $1`,
      [result.appointmentId],
    );
    expect(confirmedReservation.rows).toEqual([{ status: 'BOOKED' }]);
  });
});
