import {
  CalendarAdapter,
  CalendarEvent,
  CalendarEventLookup,
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
