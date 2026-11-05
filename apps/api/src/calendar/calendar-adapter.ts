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

export interface CalendarAdapter {
  createEvent(event: CalendarEvent): Promise<{ externalEventId: string }>;
  getEvent(externalEventId: string): Promise<CalendarEventLookup>;
  cancelEvent(externalEventId: string): Promise<void>;
}
