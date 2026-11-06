export interface CalendarEvent {
  operationId: string;
  tenantId: string;
  summary: string;
  startAt: Date;
  endAt: Date;
  professionalId: string;
}

export interface CalendarEventLookup {
  exists: boolean;
  startAt?: Date;
  endAt?: Date;
}

export interface BusyBlock {
  startAt: Date;
  endAt: Date;
}

export interface CalendarAdapter {
  eventIdFor(operationId: string): string;
  createEvent(event: CalendarEvent): Promise<{ externalEventId: string }>;
  getEvent(externalEventId: string): Promise<CalendarEventLookup>;
  cancelEvent(externalEventId: string): Promise<void>;
  /** Busy blocks from a doctor's calendar (personal events included). */
  isBusy?(from: Date, to: Date, calendarId?: string): Promise<BusyBlock[]>;
}
