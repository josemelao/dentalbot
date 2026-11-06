import {
  BusyBlock,
  CalendarAdapter,
  CalendarEvent,
  CalendarEventLookup,
} from './calendar-adapter';

export class FakeCalendarAdapter implements CalendarAdapter {
  readonly events = new Map<string, CalendarEvent>();
  readonly cancelled: string[] = [];
  readonly busy: BusyBlock[] = [];

  failNextCreate: Error | null = null;
  createThenThrow: Error | null = null;
  failNextCancel: Error | null = null;
  cancelThenThrow: Error | null = null;

  eventIdFor(operationId: string): string {
    return `fake-${operationId}`;
  }

  async createEvent(event: CalendarEvent): Promise<{ externalEventId: string }> {
    if (this.failNextCreate) {
      const error = this.failNextCreate;
      this.failNextCreate = null;
      throw error;
    }

    const externalEventId = this.eventIdFor(event.operationId);
    this.events.set(externalEventId, event);

    if (this.createThenThrow) {
      const error = this.createThenThrow;
      this.createThenThrow = null;
      throw error;
    }

    return { externalEventId };
  }

  async getEvent(externalEventId: string): Promise<CalendarEventLookup> {
    const event = this.events.get(externalEventId);
    if (!event) return { exists: false };
    return { exists: true, startAt: event.startAt, endAt: event.endAt };
  }

  /** Simulates the doctor's personal events. */
  async isBusy(from: Date, to: Date): Promise<BusyBlock[]> {
    return this.busy.filter((block) => block.startAt < to && block.endAt > from);
  }

  async cancelEvent(externalEventId: string): Promise<void> {    if (this.failNextCancel) {
      const error = this.failNextCancel;
      this.failNextCancel = null;
      throw error;
    }

    this.events.delete(externalEventId);
    this.cancelled.push(externalEventId);

    if (this.cancelThenThrow) {
      const error = this.cancelThenThrow;
      this.cancelThenThrow = null;
      throw error;
    }
  }
}
