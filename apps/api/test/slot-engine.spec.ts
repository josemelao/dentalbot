import { SlotEngine } from '../src/scheduling/slot-engine';

const service = {
  id: 'svc-cleaning',
  name: 'Limpeza',
  keywords: ['limpeza', 'profilaxia'],
  isEvaluation: false,
  durationMinutes: 40,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 10,
  directBookingAllowed: true,
  requiresEvaluation: false,
};

const caio = { id: 'prof-caio', name: 'Dr. Caio', status: 'active' };
const chow = { id: 'prof-chow', name: 'Dr. Chow', status: 'active' };

const mondayHours = (professionalId: string) => [
  { professionalId, weekday: 1, startTime: '09:00', endTime: '12:00' },
  { professionalId, weekday: 1, startTime: '13:00', endTime: '18:00' },
];

const baseInput = (overrides: Record<string, unknown> = {}) => ({
  request: {
    tenantId: 't',
    serviceId: service.id,
    quantity: 1,
    professionalId: caio.id,
    locationId: 'loc',
    from: new Date('2026-11-09T00:00:00-03:00'),
    to: new Date('2026-11-09T23:59:59-03:00'),
    now: new Date('2026-11-08T12:00:00-03:00'),
  },
  service,
  variant: null,
  qualifiedProfessionals: [caio],
  requirements: [],
  workingHours: mondayHours(caio.id),
  timeOff: [],
  holidays: [],
  reservations: [],
  resourceReservations: [],
  locks: [],
  resources: [{ id: 'chair-1', status: 'active' }],
  timezone: 'America/Sao_Paulo',
  granularityMinutes: 15,
  minAdvanceMinutes: 60,
  maxHorizonDays: 90,
  ...overrides,
});

describe('SlotEngine.findSlots', () => {
  it('generates slots inside working hours with the after-buffer', () => {
    const slots = new SlotEngine().findSlots(
      baseInput({
        workingHours: [
          { professionalId: caio.id, weekday: 1, startTime: '09:00', endTime: '12:00' },
        ],
      }),
    );
    expect(slots[0].startAt.toISOString()).toBe('2026-11-09T12:00:00.000Z'); // 09:00 BRT
    expect(slots.at(-1)!.startAt.toISOString()).toBe('2026-11-09T14:00:00.000Z'); // 11:00 BRT, grade de 15 min
    expect(slots.every((slot) => slot.professionalIds.includes(caio.id))).toBe(true);
  });

  it('excludes lunch and time off', () => {
    const slots = new SlotEngine().findSlots(
      baseInput({
        workingHours: mondayHours(caio.id),
        timeOff: [
          {
            professionalId: caio.id,
            startAt: new Date('2026-11-09T13:00:00Z'),
            endAt: new Date('2026-11-09T14:00:00Z'),
          },
        ],
      }),
    );
    expect(
      slots.some(
        (slot) =>
          slot.startAt.getTime() >= new Date('2026-11-09T13:00:00Z').getTime() &&
          slot.startAt.getTime() < new Date('2026-11-09T14:00:00Z').getTime(),
      ),
    ).toBe(false);
    expect(
      slots.some(
        (slot) =>
          slot.startAt.getTime() >= new Date('2026-11-09T15:00:00Z').getTime() &&
          slot.startAt.getTime() < new Date('2026-11-09T16:00:00Z').getTime(),
      ),
    ).toBe(false);
  });

  it('excludes holidays', () => {
    const slots = new SlotEngine().findSlots(
      baseInput({ holidays: [{ locationId: 'loc', date: '2026-11-09' }] }),
    );
    expect(slots).toHaveLength(0);
  });

  it('excludes existing reservations and active locks, but not expired locks', () => {
    const reserved = new SlotEngine().findSlots(
      baseInput({
        reservations: [
          {
            professionalId: caio.id,
            startAt: new Date('2026-11-09T12:00:00Z'),
            endAt: new Date('2026-11-09T12:40:00Z'),
            status: 'BOOKED',
          },
        ],
      }),
    );
    expect(
      reserved.some((slot) => slot.startAt.toISOString() === '2026-11-09T12:00:00.000Z'),
    ).toBe(false);

    const locked = new SlotEngine().findSlots(
      baseInput({
        locks: [
          {
            professionalId: caio.id,
            startAt: new Date('2026-11-09T12:00:00Z'),
            endAt: new Date('2026-11-09T12:40:00Z'),
            expiresAt: new Date('2026-11-09T12:05:00Z'),
            status: 'ACTIVE',
          },
        ],
        request: { ...baseInput().request, now: new Date('2026-11-09T12:00:00Z') },
      }),
    );
    expect(
      locked.some((slot) => slot.startAt.toISOString() === '2026-11-09T12:00:00.000Z'),
    ).toBe(false);
    expect(locked.length).toBeGreaterThan(0);
  });

  it('requires every professional for a joint service', () => {
    const requirements = [
      { professionalId: chow.id, required: true },
      { professionalId: caio.id, required: true },
    ];
    const bothFree = new SlotEngine().findSlots(
      baseInput({
        request: { ...baseInput().request, professionalId: null },
        service: { ...service, durationMinutes: 60, bufferAfterMinutes: 10 },
        qualifiedProfessionals: [chow, caio],
        requirements,
        workingHours: [
          { professionalId: chow.id, weekday: 1, startTime: '14:00', endTime: '18:00' },
          { professionalId: caio.id, weekday: 1, startTime: '14:00', endTime: '18:00' },
        ],
      }),
    );
    expect(bothFree.length).toBeGreaterThan(0);
    expect(bothFree[0].professionalIds.sort()).toEqual([caio.id, chow.id].sort());

    const oneBusy = new SlotEngine().findSlots(
      baseInput({
        request: { ...baseInput().request, professionalId: null },
        service: { ...service, durationMinutes: 60, bufferAfterMinutes: 10 },
        qualifiedProfessionals: [chow, caio],
        requirements,
        workingHours: [
          { professionalId: chow.id, weekday: 1, startTime: '14:00', endTime: '18:00' },
          { professionalId: caio.id, weekday: 1, startTime: '14:00', endTime: '18:00' },
        ],
        reservations: [
          {
            professionalId: caio.id,
            startAt: new Date('2026-11-09T17:00:00Z'),
            endAt: new Date('2026-11-09T18:00:00Z'),
            status: 'BOOKED',
          },
        ],
      }),
    );
    expect(
      oneBusy.every((slot) => slot.startAt.toISOString() !== '2026-11-09T17:00:00.000Z'),
    ).toBe(true);
  });

  it('does not offer a slot when the chair is reserved', () => {
    const slots = new SlotEngine().findSlots(
      baseInput({
        resourceReservations: [
          {
            resourceId: 'chair-1',
            startAt: new Date('2026-11-09T12:00:00Z'),
            endAt: new Date('2026-11-09T21:00:00Z'),
            status: 'BOOKED',
          },
        ],
      }),
    );
    expect(slots).toHaveLength(0);
  });

  it('respects minimum advance and maximum horizon', () => {
    const tooSoon = new SlotEngine().findSlots(
      baseInput({
        request: { ...baseInput().request, now: new Date('2026-11-09T11:30:00Z') },
      }),
    );
    expect(tooSoon.length).toBeGreaterThan(0);
    expect(tooSoon[0].startAt.getTime()).toBeGreaterThanOrEqual(
      new Date('2026-11-09T12:30:00Z').getTime(),
    );

    const beyondHorizon = new SlotEngine().findSlots(
      baseInput({
        request: {
          ...baseInput().request,
          from: new Date('2026-11-10T00:00:00-03:00'),
          to: new Date('2026-11-10T23:59:59-03:00'),
        },
        workingHours: [
          { professionalId: caio.id, weekday: 2, startTime: '09:00', endTime: '12:00' },
        ],
        maxHorizonDays: 0,
      }),
    );
    expect(beyondHorizon).toHaveLength(0);
  });
});
