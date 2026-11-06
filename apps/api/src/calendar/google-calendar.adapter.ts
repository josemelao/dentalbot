import {
  CalendarAdapter,
  CalendarEvent,
  CalendarEventLookup,
  BusyBlock,
} from './calendar-adapter';

export interface GoogleCalendarOptions {
  calendarId: string;
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface GoogleEventResponse {
  id?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
}

export class GoogleCalendarAdapter implements CalendarAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: GoogleCalendarOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://www.googleapis.com/calendar/v3';
  }

  eventIdFor(operationId: string): string {
    return `dental${operationId.replace(/-/g, '')}`;
  }

  async createEvent(event: CalendarEvent): Promise<{ externalEventId: string }> {
    const eventId = this.eventIdFor(event.operationId);
    const response = await this.fetchImpl(this.eventsUrl(), {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        id: eventId,
        summary: event.summary,
        start: { dateTime: event.startAt.toISOString(), timeZone: 'UTC' },
        end: { dateTime: event.endAt.toISOString(), timeZone: 'UTC' },
        extendedProperties: {
          private: { operation_id: event.operationId },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Google Calendar create failed: ${response.status}`);
    }

    const body = (await response.json()) as GoogleEventResponse;
    return { externalEventId: body.id ?? eventId };
  }

  async getEvent(externalEventId: string): Promise<CalendarEventLookup> {
    const response = await this.fetchImpl(
      `${this.eventsUrl()}/${encodeURIComponent(externalEventId)}`,
      { headers: await this.headers() },
    );

    if (response.status === 404) return { exists: false };
    if (!response.ok) {
      throw new Error(`Google Calendar get failed: ${response.status}`);
    }

    const body = (await response.json()) as GoogleEventResponse;
    return {
      exists: true,
      startAt: body.start?.dateTime ? new Date(body.start.dateTime) : undefined,
      endAt: body.end?.dateTime ? new Date(body.end.dateTime) : undefined,
    };
  }

  async cancelEvent(externalEventId: string): Promise<void> {
    const response = await this.fetchImpl(
      `${this.eventsUrl()}/${encodeURIComponent(externalEventId)}`,
      { method: 'DELETE', headers: await this.headers() },
    );

    if (response.status === 404) return;
    if (!response.ok) {
      throw new Error(`Google Calendar cancel failed: ${response.status}`);
    }
  }

  /**
   * Free/busy returns only busy blocks, never titles: the bot learns that a
   * time is taken, not what the doctor is doing.
   */
  async isBusy(from: Date, to: Date, calendarId?: string): Promise<BusyBlock[]> {
    const target = calendarId ?? this.options.calendarId;
    const response = await this.fetchImpl(`${this.baseUrl}/freeBusy`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: target }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Google Calendar freeBusy failed: ${response.status}`);
    }

    const body = (await response.json()) as {
      calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }> }>;
    };
    const busy = body.calendars?.[target]?.busy ?? [];

    return busy
      .filter((block) => block.start && block.end)
      .map((block) => ({
        startAt: new Date(block.start as string),
        endAt: new Date(block.end as string),
      }));
  }

  private eventsUrl(): string {
    return `${this.baseUrl}/calendars/${encodeURIComponent(this.options.calendarId)}/events`;
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      authorization: `Bearer ${await this.options.getAccessToken()}`,
      'content-type': 'application/json',
    };
  }
}
