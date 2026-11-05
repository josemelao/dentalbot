import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { CatalogRepository } from '../src/db/repositories/catalog.repository';
import { AvailabilityService } from '../src/scheduling/availability.service';
import { SlotEngine } from '../src/scheduling/slot-engine';

const build = (pool: any) =>
  new AvailabilityService(new CatalogRepository(pool), new SlotEngine(), {
    granularityMinutes: 15,
    minAdvanceMinutes: 120,
    maxHorizonDays: 90,
  });

describe('AvailabilityService', () => {
  it('returns slots for a Monday cleaning with the seeded schedule', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const s = await seedScheduling(pool, clinic.tenantId);

    const slots = await build(pool).findSlots({
      tenantId: clinic.tenantId,
      serviceId: s.cleaningServiceId,
      quantity: 1,
      professionalId: s.caioId,
      locationId: s.locationId,
      from: new Date('2026-11-09T00:00:00-03:00'),
      to: new Date('2026-11-09T23:59:59-03:00'),
      now: new Date('2026-11-08T12:00:00-03:00'),
    });

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].professionalIds).toContain(s.caioId);
  });

  it('throws SERVICE_NOT_FOUND for a different tenant', async () => {
    const pool = getTestPool();
    const a = await seedClinic(pool, { suffix: 'a' });
    const b = await seedClinic(pool, { suffix: 'b' });
    const s = await seedScheduling(pool, a.tenantId);

    await expect(
      build(pool).findSlots({
        tenantId: b.tenantId,
        serviceId: s.cleaningServiceId,
        quantity: 1,
        professionalId: null,
        locationId: s.locationId,
        from: new Date('2026-11-09T00:00:00-03:00'),
        to: new Date('2026-11-09T23:59:59-03:00'),
        now: new Date('2026-11-08T12:00:00-03:00'),
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND' });
  });
});
