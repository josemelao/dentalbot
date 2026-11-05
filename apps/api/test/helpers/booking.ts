import { Pool } from 'pg';
import { CatalogRepository } from '../../src/db/repositories/catalog.repository';
import { AppointmentsRepository } from '../../src/db/repositories/appointments.repository';
import { OperationsRepository } from '../../src/db/repositories/operations.repository';
import { LocksRepository } from '../../src/db/repositories/locks.repository';
import { AvailabilityService } from '../../src/scheduling/availability.service';
import { SlotEngine } from '../../src/scheduling/slot-engine';
import { BookingService } from '../../src/scheduling/booking.service';
import { FakeCalendarAdapter } from '../../src/calendar/fake-calendar.adapter';

export function buildBookingService(
  pool: Pool,
  calendar = new FakeCalendarAdapter(),
): BookingService {
  return new BookingService({
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
}

export function bookingInput(clinic: any, s: any, overrides: Record<string, unknown> = {}) {
  return {
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
  };
}
