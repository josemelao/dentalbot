import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { buildBookingService, bookingInput } from './helpers/booking';
import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';

describe('BookingService.reschedule', () => {
  it('creates the new booking first, then cancels the old one', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    const service = buildBookingService(pool, calendar);

    const old = await service.book(bookingInput(clinic, s, { idempotencyKey: 'old' }));
    if (old.status !== 'BOOKED') throw new Error('setup failed');

    const result = await service.reschedule({
      tenantId: clinic.tenantId,
      appointmentId: old.appointment.id,
      newStartAt: new Date('2026-11-09T13:15:00Z'),
      professionalIds: [s.caioId],
      idempotencyKey: 'resched-1',
    });
    expect(result.status).toBe('BOOKED');

    const oldRow = await pool.query(`select status from appointments where id = $1`, [
      old.appointment.id,
    ]);
    expect(oldRow.rows[0].status).toBe('CANCELLED');

    const oldReservations = await pool.query(
      `select status from professional_reservations where appointment_id = $1`,
      [old.appointment.id],
    );
    expect(oldReservations.rows).toEqual([{ status: 'RELEASED' }]);
    expect(calendar.cancelled).toContain(old.appointment.googleEventId);
  });

  it('keeps the old appointment when the new slot is taken', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const service = buildBookingService(pool);

    const old = await service.book(bookingInput(clinic, s, { idempotencyKey: 'old' }));
    const other = await service.book(
      bookingInput(clinic, s, {
        idempotencyKey: 'other',
        startAt: new Date('2026-11-09T13:15:00Z'),
      }),
    );
    if (old.status !== 'BOOKED' || other.status !== 'BOOKED') {
      throw new Error('setup failed');
    }

    const result = await service.reschedule({
      tenantId: clinic.tenantId,
      appointmentId: old.appointment.id,
      newStartAt: new Date('2026-11-09T13:15:00Z'),
      professionalIds: [s.caioId],
      idempotencyKey: 'resched-conflict',
    });
    expect(result.status).toBe('CONFLICT');

    const oldRow = await pool.query(`select status from appointments where id = $1`, [
      old.appointment.id,
    ]);
    expect(oldRow.rows[0].status).toBe('BOOKED');
  });

  it('marks UNKNOWN when the old event cannot be cancelled after the new one is confirmed', async () => {
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

    const oldRow = await pool.query(`select status from appointments where id = $1`, [
      old.appointment.id,
    ]);
    expect(oldRow.rows[0].status).toBe('BOOKED');
  });

  it('returns the completed reschedule for a repeated idempotency key', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const service = buildBookingService(pool);

    const old = await service.book(bookingInput(clinic, s, { idempotencyKey: 'old' }));
    if (old.status !== 'BOOKED') throw new Error('setup failed');

    const first = await service.reschedule({
      tenantId: clinic.tenantId,
      appointmentId: old.appointment.id,
      newStartAt: new Date('2026-11-09T13:15:00Z'),
      professionalIds: [s.caioId],
      idempotencyKey: 'resched-1',
    });
    expect(first.status).toBe('BOOKED');
    if (first.status !== 'BOOKED') return;

    const second = await service.reschedule({
      tenantId: clinic.tenantId,
      appointmentId: old.appointment.id,
      newStartAt: new Date('2026-11-09T13:15:00Z'),
      professionalIds: [s.caioId],
      idempotencyKey: 'resched-1',
    });
    expect(second.status).toBe('BOOKED');
    if (second.status !== 'BOOKED') return;
    expect(second.appointment.id).toBe(first.appointment.id);
  });
});
