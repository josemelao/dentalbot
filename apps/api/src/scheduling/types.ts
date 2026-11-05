export interface SlotRequest {
  tenantId: string;
  serviceId: string;
  quantity: number;
  professionalId: string | null;
  locationId: string;
  from: Date;
  to: Date;
  now: Date;
}

export interface Slot {
  startAt: Date;
  endAt: Date;
  professionalIds: string[];
  resourceId: string | null;
}

export interface SlotService {
  id: string;
  name?: string;
  keywords?: string[];
  isEvaluation?: boolean;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  directBookingAllowed: boolean;
  requiresEvaluation: boolean;
}

export interface SlotProfessional {
  id: string;
  name: string;
  status: string;
}

export interface SlotRequirement {
  professionalId: string;
  required: boolean;
}

export interface SlotWorkingHour {
  professionalId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface SlotTimeOff {
  professionalId: string;
  startAt: Date;
  endAt: Date;
}

export interface SlotHoliday {
  locationId: string | null;
  date: string;
}

export interface SlotReservation {
  professionalId: string;
  startAt: Date;
  endAt: Date;
  status: string;
}

export interface SlotResourceReservation {
  resourceId: string;
  startAt: Date;
  endAt: Date;
  status: string;
}

export interface SlotLock {
  professionalId: string;
  startAt: Date;
  endAt: Date;
  expiresAt: Date;
  status: string;
}

export interface SlotResource {
  id: string;
  status: string;
}

export interface SlotEngineInput {
  request: SlotRequest;
  service: SlotService;
  variant: { durationMinutes: number } | null;
  qualifiedProfessionals: SlotProfessional[];
  requirements: SlotRequirement[];
  workingHours: SlotWorkingHour[];
  timeOff: SlotTimeOff[];
  holidays: SlotHoliday[];
  reservations: SlotReservation[];
  resourceReservations: SlotResourceReservation[];
  locks: SlotLock[];
  resources: SlotResource[];
  timezone: string;
  granularityMinutes: number;
  minAdvanceMinutes: number;
  maxHorizonDays: number;
}
