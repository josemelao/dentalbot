import { GoogleCalendarAdapter } from '../src/calendar/google-calendar.adapter';

const event = {
  operationId: 'op-1',
  tenantId: 't',
  summary: 'Limpeza — Maria',
  startAt: new Date('2026-11-09T12:15:00Z'),
  endAt: new Date('2026-11-09T12:55:00Z'),
  professionalId: 'prof-caio',
};

describe('GoogleCalendarAdapter', () => {
  it('creates an event with a deterministic id and operation metadata', async () => {
    const calls: Array<{ url: string; init: any; body: any }> = [];
    const fetchImpl = async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: 'dentalop1' }), { status: 200 });
    };
    const calendar = new GoogleCalendarAdapter({
      calendarId: 'clinic@example.com',
      getAccessToken: async () => 'token',
      fetchImpl: fetchImpl as typeof fetch,
      baseUrl: 'https://calendar.test',
    });

    const result = await calendar.createEvent(event);

    expect(result.externalEventId).toBe('dentalop1');
    expect(calendar.eventIdFor('op-1')).toBe('dentalop1');
    expect(calls[0].body.id).toBe('dentalop1');
    expect(calls[0].body.extendedProperties.private.operation_id).toBe('op-1');
    expect(calls[0].init.headers.authorization).toBe('Bearer token');
  });

  it('returns exists=false for a missing event', async () => {
    const calendar = new GoogleCalendarAdapter({
      calendarId: 'clinic@example.com',
      getAccessToken: async () => 'token',
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
      baseUrl: 'https://calendar.test',
    });

    expect(await calendar.getEvent('missing')).toEqual({ exists: false });
  });

  it('treats a 404 on cancel as already cancelled', async () => {
    const calendar = new GoogleCalendarAdapter({
      calendarId: 'clinic@example.com',
      getAccessToken: async () => 'token',
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
      baseUrl: 'https://calendar.test',
    });

    await expect(calendar.cancelEvent('missing')).resolves.toBeUndefined();
  });
});
