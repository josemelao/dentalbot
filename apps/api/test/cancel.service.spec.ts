import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { buildBookingService, bookingInput } from './helpers/booking';
import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';

describe('BookingService.cancel', () => {
  it('cancels a booked appointment, releases reservations and cancels the event', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    const service = buildBookingService(pool, calendar);

    const booked = await service.book(bookingInput(clinic, s));
    if (booked.status !== 'BOOKED') throw new Error('setup failed');

    const result = await service.cancel({
      tenantId: clinic.tenantId,
      appointmentId: booked.appointment.id,
      idempotencyKey: 'cancel-1',
      now: new Date('2026-11-08T09:00:00Z'),
    });
    expect(result.status).toBe('CANCELLED');

    const row = await pool.query(
      `select status, attendance_status from appointments where id = $1`,
      [booked.appointment.id],
    );
    expect(row.rows[0]).toEqual({ status: 'CANCELLED', attendance_status: 'PENDING' });

    const reservations = await pool.query(
      `select status from professional_reservations where appointment_id = $1`,
      [booked.appointment.id],
    );
    expect(reservations.rows).toEqual([{ status: 'RELEASED' }]);
    expect(calendar.cancelled).toContain(booked.appointment.googleEventId);
  });

  it('marks a cancellation inside 24 hours as late', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const service = buildBookingService(pool);

    const booked = await service.book(bookingInput(clinic, s));
    if (booked.status !== 'BOOKED') throw new Error('setup failed');

    const result = await service.cancel({
      tenantId: clinic.tenantId,
      appointmentId: booked.appointment.id,
      idempotencyKey: 'cancel-late',
      now: new Date('2026-11-09T09:00:00Z'),
    });
    expect(result.status).toBe('CANCELLED');

    const row = await pool.query(`select attendance_status from appointments where id = $1`, [
      booked.appointment.id,
    ]);
    expect(row.rows[0].attendance_status).toBe('LATE_CANCELLED');
  });

  it('is idempotent for a repeated cancel', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const service = buildBookingService(pool);

    const booked = await service.book(bookingInput(clinic, s));
    if (booked.status !== 'BOOKED') throw new Error('setup failed');

    await service.cancel({
      tenantId: clinic.tenantId,
      appointmentId: booked.appointment.id,
      idempotencyKey: 'cancel-1',
      now: new Date('2026-11-08T09:00:00Z'),
    });
    const second = await service.cancel({
      tenantId: clinic.tenantId,
      appointmentId: booked.appointment.id,
      idempotencyKey: 'cancel-2',
      now: new Date('2026-11-08T09:00:00Z'),
    });
    expect(second.status).toBe('CANCELLED');
  });
});
