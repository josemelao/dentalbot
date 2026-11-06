import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';
import { CatalogRepository } from '../src/db/repositories/catalog.repository';
import { AvailabilityService } from '../src/scheduling/availability.service';
import { SlotEngine } from '../src/scheduling/slot-engine';
import { getTestPool, seedClinic, seedScheduling } from './helpers/db';

const request = (clinic: any, scheduling: any) => ({
  tenantId: clinic.tenantId,
  serviceId: scheduling.cleaningServiceId,
  quantity: 1,
  professionalId: scheduling.caioId,
  locationId: scheduling.locationId,
  from: new Date('2026-11-09T09:00:00Z'),
  to: new Date('2026-11-09T23:59:59Z'),
  now: new Date('2026-11-09T09:00:00Z'),
});

const build = (pool: any, calendar: FakeCalendarAdapter) =>
  new AvailabilityService(
    new CatalogRepository(pool),
    new SlotEngine(),
    { granularityMinutes: 15, minAdvanceMinutes: 0, maxHorizonDays: 90 },
    calendar,
  );

describe('calendar free/busy', () => {
  it('removes a slot that collides with the doctor personal calendar', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const scheduling = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    const availability = build(pool, calendar);

    const before = await availability.findSlots(request(clinic, scheduling));
    expect(before.length).toBeGreaterThan(0);

    const blocked = before[0];
    calendar.busy.push({ startAt: blocked.startAt, endAt: blocked.endAt });

    const after = await availability.findSlots(request(clinic, scheduling));

    expect(after.length).toBeLessThan(before.length);
    expect(
      after.some((slot) => slot.startAt.getTime() === blocked.startAt.getTime()),
    ).toBe(false);
  });

  it('keeps offering slots when the calendar lookup fails', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const scheduling = await seedScheduling(pool, clinic.tenantId);

    const calendar = new FakeCalendarAdapter();
    calendar.isBusy = async () => {
      throw new Error('google down');
    };

    const slots = await build(pool, calendar).findSlots(request(clinic, scheduling));
    expect(slots.length).toBeGreaterThan(0);
  });
});
