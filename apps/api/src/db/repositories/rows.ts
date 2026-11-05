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
  | 'fallback';
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
}
