import { Pool } from 'pg';
import { DateTime } from 'luxon';
import { CatalogRepository } from '../db/repositories/catalog.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { KnowledgeRepository } from '../db/repositories/knowledge.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { MessageTemplatesRepository } from '../db/repositories/message-templates.repository';
import { PendingRepliesRepository } from '../db/repositories/pending-replies.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { KnowledgeEntry, Message, Service } from '../db/repositories/rows';
import { TicketsRepository } from '../db/repositories/tickets.repository';
import { TEMPLATE_DEFINITIONS } from '../messages/templates';
import { ShadowModeService } from '../pipeline/pending-reply.service';
import { AttendanceService, DayRow } from '../scheduling/attendance.service';

export interface PanelTicket {
  id: string;
  reason: string;
  status: string;
  summary: string;
  question: string;
  slaDueAt: Date;
  patientLabel: string;
  acceptedAt: Date | null;
  unreadCount: number;
}

export interface TicketDetail {
  ticket: PanelTicket;
  conversationId: string;
  patientLabel: string;
  timezone: string;
  messages: Message[];
}

export interface PanelTemplate {
  key: string;
  label: string;
  locked: boolean;
  variants: string[];
  edited: boolean;
}

export interface PanelPendingReply {
  id: string;
  content: string;
  patientLabel: string;
  createdAt: Date;
}

export interface PanelData {
  clinicName: string;
  timezone: string;
  dateISO: string;
  agenda: DayRow[];
  tickets: PanelTicket[];
  knowledge: KnowledgeEntry[];
  services: Service[];
  templates: PanelTemplate[];
  shadowMode: boolean;
  pendingReplies: PanelPendingReply[];
}

export interface PanelServiceDependencies {
  pool: Pool;
  attendance: AttendanceService;
  tickets: TicketsRepository;
  knowledge: KnowledgeRepository;
  catalog: CatalogRepository;
  messages: MessagesRepository;
  conversations: ConversationsRepository;
  patients: PatientsRepository;
  templates: MessageTemplatesRepository;
  pending: PendingRepliesRepository;
  shadow: ShadowModeService;
}

/** Read-only view model for the pilot panel. No writes live here yet. */
export class PanelService {
  constructor(private readonly deps: PanelServiceDependencies) {}

  async activeClinic(): Promise<{ id: string; name: string; timezone: string } | null> {
    const clinics = await this.deps.pool.query<{
      id: string;
      name: string;
      timezone: string;
    }>(
      `select id, name, timezone from clinics where status = 'active'
       order by created_at limit 1`,
    );
    return clinics.rows[0] ?? null;
  }

  async load(dateISO?: string): Promise<PanelData | null> {
    const clinic = await this.activeClinic();
    if (!clinic) return null;

    const date = dateISO ?? DateTime.now().setZone(clinic.timezone).toISODate() ?? '';

    const [agenda, tickets, knowledge, services, templateRows, pending, shadowMode] =
      await Promise.all([
        this.deps.attendance.listDay(clinic.id, date),
        this.deps.tickets.listOpen(clinic.id),
        this.deps.knowledge.listAll(clinic.id),
        this.deps.catalog.listAllServices(clinic.id),
        this.deps.templates.listActive(clinic.id),
        this.deps.pending.listPending(clinic.id),
        this.deps.shadow.isEnabled(clinic.id),
      ]);

    const overrides = new Map(templateRows.map((row) => [row.key, row.variants]));
    const templates = TEMPLATE_DEFINITIONS.map((definition) => ({
      key: definition.key,
      label: definition.label,
      locked: definition.locked,
      variants: overrides.get(definition.key) ?? definition.defaults,
      edited: overrides.has(definition.key),
    }));

    return {
      clinicName: clinic.name,
      timezone: clinic.timezone,
      dateISO: date,
      agenda,
      knowledge,
      services,
      templates,
      shadowMode,
      pendingReplies: pending.map((row) => ({
        id: row.id,
        content: row.content,
        patientLabel: row.patientLabel?.trim() || `contato •••${row.externalUserId.slice(-4)}`,
        createdAt: row.createdAt,
      })),
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        reason: ticket.reason,
        status: ticket.status,
        summary: ticket.summary,
        question: ticket.question,
        slaDueAt: ticket.slaDueAt,
        patientLabel: ticket.patientLabel?.trim() || `contato •••${ticket.externalUserId.slice(-4)}`,
        acceptedAt: ticket.acceptedAt,
        unreadCount: ticket.unreadCount,
      })),
    };
  }

  /** Ticket detail with the full conversation. Opening it marks it as read. */
  async openTicket(tenantId: string, ticketId: string): Promise<TicketDetail | null> {
    const ticket = await this.deps.tickets.findById(tenantId, ticketId);
    if (!ticket) return null;

    const contact = await this.deps.patients.findContactById(
      tenantId,
      ticket.patientContactId,
    );
    const messages = await this.deps.messages.listRecent(
      tenantId,
      ticket.conversationId,
      100,
    );
    const clinic = await this.activeClinic();

    await this.deps.conversations.markPanelRead(
      tenantId,
      ticket.conversationId,
      new Date(),
    );

    const patientLabel =
      contact?.displayName?.trim() || `contato •••${(contact?.externalUserId ?? '').slice(-4)}`;

    return {
      ticket: {
        id: ticket.id,
        reason: ticket.reason,
        status: ticket.status,
        summary: ticket.summary,
        question: ticket.question,
        slaDueAt: ticket.slaDueAt,
        patientLabel,
        acceptedAt: ticket.acceptedAt,
        unreadCount: 0,
      },
      conversationId: ticket.conversationId,
      patientLabel,
      timezone: clinic?.timezone ?? 'America/Sao_Paulo',
      messages,
    };
  }
}
