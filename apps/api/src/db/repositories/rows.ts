import { Channel, MessageType } from '../../contracts/channel';

export type ConversationState = 'ACTIVE' | 'REQUIRES_HUMAN' | 'HUMAN_ACTIVE' | 'CLOSED';
export type UserRole = 'owner' | 'dentist' | 'receptionist' | 'admin';
export type TicketReason = 'CLINICAL' | 'UNKNOWN' | 'HUMAN_REQUEST' | 'EMERGENCY';
export type TicketStatus = 'open' | 'notified' | 'answered' | 'resolved' | 'cancelled';
export type TicketEvent =
  | 'created'
  | 'notified'
  | 'accepted'
  | 'answered'
  | 'resolved'
  | 'fallback'
  | 'reclassified';
export type KnowledgeStatus = 'draft' | 'approved' | 'retired';

export interface Clinic {
  id: string;
  name: string;
  timezone: string;
  locale: string;
  status: string;
}

export interface ClinicChannel {
  id: string;
  tenantId: string;
  channel: Channel;
  externalChannelId: string;
  displayName: string | null;
  status: string;
}

export interface ClinicUser {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phoneE164: string | null;
  role: UserRole;
  status: string;
}

export interface OwnerRecipient {
  userId: string;
  name: string;
  externalUserId: string;
}

export interface PatientContact {
  id: string;
  tenantId: string;
  patientId: string | null;
  channel: Channel;
  externalUserId: string;
  displayName: string | null;
  optInStatus: 'unknown' | 'opted_in' | 'opted_out';
}

export interface Conversation {
  id: string;
  tenantId: string;
  patientContactId: string;
  channel: Channel;
  state: ConversationState;
  humanTicketId: string | null;
  context: Record<string, unknown>;
}

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  channel: Channel;
  direction: 'in' | 'out';
  externalMessageId: string | null;
  messageType: MessageType;
  content: string | null;
  media: unknown;
  deliveryStatus: string;
  createdAt: Date;
}

export interface KnowledgeEntry {
  id: string;
  tenantId: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
  status: KnowledgeStatus;
  validFrom: Date;
  validTo: Date | null;
}

export interface HumanTicket {
  id: string;
  tenantId: string;
  conversationId: string;
  patientContactId: string;
  status: TicketStatus;
  reason: TicketReason;
  summary: string;
  question: string;
  options: unknown;
  answer: string | null;
  slaDueAt: Date;
  acceptedAt: Date | null;
  acceptedBy: string | null;
}

export interface Service {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  keywords: string[];
  isEvaluation: boolean;
  durationMinutes: number;
  price: string;
  priceDisclosureAllowed: boolean;
  directBookingAllowed: boolean;
  requiresEvaluation: boolean;
  preparationInstructions: string | null;
  requiredDocuments: string[];
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  status: string;
}

export interface ServiceVariant {
  id: string;
  tenantId: string;
  serviceId: string;
  minQuantity: number;
  maxQuantity: number;
  price: string;
  durationMinutes: number;
}

export interface Professional {
  id: string;
  tenantId: string;
  clinicUserId: string | null;
  locationId: string;
  name: string;
  specialty: string | null;
  calendarRef: string | null;
  status: string;
}

export interface ProfessionalWorkingHour {
  id: string;
  tenantId: string;
  professionalId: string;
  locationId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom: string;
  validTo: string | null;
}

export interface ProfessionalTimeOff {
  id: string;
  tenantId: string;
  professionalId: string;
  startAt: Date;
  endAt: Date;
  reason: string | null;
}

export interface ClinicHoliday {
  id: string;
  tenantId: string;
  locationId: string | null;
  date: string;
  name: string;
}

export interface ProfessionalReservation {
  id: string;
  tenantId: string;
  appointmentId: string;
  professionalId: string;
  startAt: Date;
  endAt: Date;
  status: 'BOOKED' | 'RESCHEDULE_PENDING' | 'RELEASED';
}

export interface ResourceReservation {
  id: string;
  tenantId: string;
  appointmentId: string;
  resourceId: string;
  startAt: Date;
  endAt: Date;
  status: 'BOOKED' | 'RESCHEDULE_PENDING' | 'RELEASED';
}

export interface AvailabilityLock {
  id: string;
  tenantId: string;
  professionalId: string;
  startAt: Date;
  endAt: Date;
  expiresAt: Date;
  operationId: string | null;
  status: 'ACTIVE' | 'RELEASED' | 'EXPIRED';
}

export interface Appointment {
  id: string;
  tenantId: string;
  patientContactId: string;
  patientId: string | null;
  serviceId: string;
  locationId: string;
  resourceId: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
  source: string;
  createdBy: string | null;
  cancellationReason: string | null;
  attendanceStatus: string;
  confirmationStatus: string;
  googleEventId: string | null;
  operationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppointmentOperation {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  operationType: 'BOOK' | 'RESCHEDULE' | 'CANCEL';
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';
  requestPayload: unknown;
  resultPayload: unknown;
  externalReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceProfessionalRequirement {
  id: string;
  tenantId: string;
  serviceId: string;
  professionalId: string;
  role: 'primary' | 'assistant' | 'required';
  required: boolean;
}

export interface Resource {
  id: string;
  tenantId: string;
  locationId: string;
  name: string;
  kind: string;
  status: string;
}
