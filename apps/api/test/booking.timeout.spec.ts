import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { buildBookingService, bookingInput } from './helpers/booking';
import { AppointmentsRepository } from '../src/db/repositories/appointments.repository';
import { LocksRepository } from '../src/db/repositories/locks.repository';
import { OperationsRepository } from '../src/db/repositories/operations.repository';
import { ReconciliationService } from '../src/scheduling/reconciliation.service';
import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';

describe('BookingService timeout and reconciliation', () => {
  it('reconciles an UNKNOWN booking when the event exists', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    calendar.createThenThrow = new Error('ETIMEDOUT');
    const service = buildBookingService(pool, calendar);

    const result = await service.book(bookingInput(clinic, s));
    expect(result.status).toBe('UNKNOWN');
    if (result.status !== 'UNKNOWN') return;

    const reconciliation = new ReconciliationService({
      operations: new OperationsRepository(pool),
      appointments: new AppointmentsRepository(pool),
      locks: new LocksRepository(pool),
      calendar,
    });
    const summary = await reconciliation.reconcileUnknown(clinic.tenantId);
    expect(summary.confirmed).toBe(1);

    const appointment = await pool.query(
      `select status, google_event_id from appointments where id = $1`,
      [result.appointmentId],
    );
    expect(appointment.rows[0].status).toBe('BOOKED');
    expect(appointment.rows[0].google_event_id).toBe(`fake-${result.operationId}`);
  });

  it('cancels and releases the slot when the event was never created', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    calendar.failNextCreate = new Error('calendar down');
    const service = buildBookingService(pool, calendar);

    const result = await service.book(bookingInput(clinic, s));
    expect(result.status).toBe('UNKNOWN');
    if (result.status !== 'UNKNOWN') return;

    const reconciliation = new ReconciliationService({
      operations: new OperationsRepository(pool),
      appointments: new AppointmentsRepository(pool),
      locks: new LocksRepository(pool),
      calendar,
    });
    const summary = await reconciliation.reconcileUnknown(clinic.tenantId);
    expect(summary.failed).toBe(1);

    const appointment = await pool.query(`select status from appointments where id = $1`, [
      result.appointmentId,
    ]);
    expect(appointment.rows[0].status).toBe('CANCELLED');
    const reservations = await pool.query(
      `select status from professional_reservations where appointment_id = $1`,
      [result.appointmentId],
    );
    expect(reservations.rows).toEqual([{ status: 'RELEASED' }]);
  });

  it('expires stale availability locks', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const s = await seedScheduling(pool, clinic.tenantId);
    const locks = new LocksRepository(pool);
    const lock = await locks.create({
      tenantId: clinic.tenantId,
      professionalId: s.caioId,
      startAt: new Date('2026-11-09T12:00:00Z'),
      endAt: new Date('2026-11-09T13:00:00Z'),
      expiresAt: new Date('2026-11-09T09:00:00Z'),
    });

    const reconciliation = new ReconciliationService({
      operations: new OperationsRepository(pool),
      appointments: new AppointmentsRepository(pool),
      locks,
      calendar: new FakeCalendarAdapter(),
    });
    const released = await reconciliation.releaseExpiredLocks(
      new Date('2026-11-09T10:00:00Z'),
    );
    expect(released).toBe(1);

    const row = await pool.query(`select status from availability_locks where id = $1`, [
      lock.id,
    ]);
    expect(row.rows[0].status).toBe('EXPIRED');
  });
});
