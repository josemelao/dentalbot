import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';

const event = {
  operationId: 'op-1',
  tenantId: 't',
  summary: 'Limpeza — Maria',
  startAt: new Date('2026-11-09T12:00:00Z'),
  endAt: new Date('2026-11-09T12:40:00Z'),
  professionalId: 'prof-caio',
};

describe('FakeCalendarAdapter', () => {
  it('creates, reads and cancels an event with a deterministic id', async () => {
    const calendar = new FakeCalendarAdapter();
    expect(calendar.eventIdFor('op-1')).toBe('fake-op-1');
    const created = await calendar.createEvent(event);
    expect(created.externalEventId).toBe('fake-op-1');
    expect(await calendar.getEvent(created.externalEventId)).toMatchObject({ exists: true });

    await calendar.cancelEvent(created.externalEventId);
    expect(await calendar.getEvent(created.externalEventId)).toEqual({ exists: false });
  });

  it('can simulate a timeout after the event was created', async () => {
    const calendar = new FakeCalendarAdapter();
    calendar.createThenThrow = new Error('ETIMEDOUT');

    await expect(calendar.createEvent(event)).rejects.toThrow(/ETIMEDOUT/);
    expect(await calendar.getEvent('fake-op-1')).toMatchObject({ exists: true });
  });

  it('can simulate a failure before the event was created', async () => {
    const calendar = new FakeCalendarAdapter();
    calendar.failNextCreate = new Error('calendar down');

    await expect(calendar.createEvent(event)).rejects.toThrow(/calendar down/);
    expect(await calendar.getEvent('fake-op-1')).toEqual({ exists: false });
  });
});
