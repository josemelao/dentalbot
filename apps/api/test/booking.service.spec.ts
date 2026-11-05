import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { CatalogRepository } from '../src/db/repositories/catalog.repository';
import { AppointmentsRepository } from '../src/db/repositories/appointments.repository';
import { OperationsRepository } from '../src/db/repositories/operations.repository';
import { LocksRepository } from '../src/db/repositories/locks.repository';
import { AvailabilityService } from '../src/scheduling/availability.service';
import { SlotEngine } from '../src/scheduling/slot-engine';
import { BookingService } from '../src/scheduling/booking.service';
import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';

const build = (pool: any, calendar = new FakeCalendarAdapter()) =>
  new BookingService({
    catalog: new CatalogRepository(pool),
    availability: new AvailabilityService(new CatalogRepository(pool), new SlotEngine(), {
      granularityMinutes: 15,
      minAdvanceMinutes: 0,
      maxHorizonDays: 90,
    }),
    appointments: new AppointmentsRepository(pool),
    operations: new OperationsRepository(pool),
    locks: new LocksRepository(pool),
    calendar,
    now: () => new Date('2026-11-09T09:00:00Z'),
  });

const input = (clinic: any, s: any, overrides: Record<string, unknown> = {}) => ({
  tenantId: clinic.tenantId,
  conversationId: clinic.conversationId!,
  patientContactId: clinic.contactId!,
  serviceId: s.cleaningServiceId,
  quantity: 1,
  professionalIds: [s.caioId],
  locationId: s.locationId,
  resourceId: s.resourceId,
  startAt: new Date('2026-11-09T12:15:00Z'),
  idempotencyKey: 'book-1',
  ...overrides,
});

describe('BookingService.book', () => {
  it('books a free slot, creates reservations and completes the operation', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    const service = build(pool, calendar);

    const result = await service.book(input(clinic, s));
    expect(result.status).toBe('BOOKED');
    if (result.status !== 'BOOKED') return;

    expect(result.appointment.status).toBe('BOOKED');
    expect(calendar.events.size).toBe(1);
    const reservations = await pool.query(
      `select status from professional_reservations where appointment_id = $1`,
      [result.appointment.id],
    );
    expect(reservations.rows).toEqual([{ status: 'BOOKED' }]);
  });

  it('returns the same appointment for a repeated idempotency key', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const service = build(pool);

    const first = await service.book(input(clinic, s));
    const second = await service.book(input(clinic, s));
    expect(second.status).toBe('BOOKED');
    if (first.status !== 'BOOKED' || second.status !== 'BOOKED') return;
    expect(second.appointment.id).toBe(first.appointment.id);
  });

  it('returns CONFLICT when the slot is already reserved', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const service = build(pool);

    await service.book(input(clinic, s, { idempotencyKey: 'book-1' }));
    const second = await service.book(input(clinic, s, { idempotencyKey: 'book-2' }));
    expect(second.status).toBe('CONFLICT');
  });

  it('marks the appointment UNKNOWN when the calendar times out after creating the event', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    calendar.createThenThrow = new Error('ETIMEDOUT');
    const service = build(pool, calendar);

    const result = await service.book(input(clinic, s));
    expect(result.status).toBe('UNKNOWN');
    if (result.status !== 'UNKNOWN') return;

    const appointment = await pool.query(`select status from appointments where id = $1`, [
      result.appointmentId,
    ]);
    expect(appointment.rows[0].status).toBe('UNKNOWN');
    const operation = await pool.query(
      `select status from appointment_operations where id = $1`,
      [result.operationId],
    );
    expect(operation.rows[0].status).toBe('UNKNOWN');
  });
});
