import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { buildBookingService, bookingInput } from './helpers/booking';

describe('BookingService concurrency', () => {
  it('books exactly one of two concurrent requests for the same slot', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const service = buildBookingService(pool);

    const [first, second] = await Promise.all([
      service.book(bookingInput(clinic, s, { idempotencyKey: 'race-1' })),
      service.book(bookingInput(clinic, s, { idempotencyKey: 'race-2' })),
    ]);

    expect([first.status, second.status].sort()).toEqual(['BOOKED', 'CONFLICT']);

    const count = await pool.query(
      `select count(*)::int as n from appointments
       where tenant_id = $1 and status = 'BOOKED'`,
      [clinic.tenantId],
    );
    expect(count.rows[0].n).toBe(1);
  });
});
