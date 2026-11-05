import { OwnerNotifier } from '../channels/owner-notifier';
import { AuditRepository } from '../db/repositories/audit.repository';
import { ChannelsRepository } from '../db/repositories/channels.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { HumanTicket, TicketReason } from '../db/repositories/rows';
import { TicketsRepository } from '../db/repositories/tickets.repository';

export interface EscalationDependencies {
  tickets: TicketsRepository;
  channels: ChannelsRepository;
  conversations: ConversationsRepository;
  audit: AuditRepository;
  notifier: OwnerNotifier;
  slaMinutes: number;
}

export interface CreateEscalationInput {
  tenantId: string;
  conversationId: string;
  patientContactId: string;
  reason: TicketReason;
  summary: string;
  question: string;
  options?: unknown;
}

export class EscalationService {
  constructor(private readonly deps: EscalationDependencies) {}

  async create(input: CreateEscalationInput): Promise<HumanTicket> {
    const existing = await this.deps.tickets.findOpenByConversation(
      input.tenantId,
      input.conversationId,
    );
    if (existing) return existing;

    const slaDueAt = new Date(Date.now() + this.deps.slaMinutes * 60_000);
    const { ticket: createdTicket, created } = await this.deps.tickets.create({
      ...input,
      slaDueAt,
    });
    if (!created) return createdTicket;

    let ticket = createdTicket;

    await this.deps.tickets.addEvent({
      tenantId: input.tenantId,
      ticketId: ticket.id,
      event: 'created',
      actorType: 'bot',
      metadata: { reason: input.reason },
    });

    await this.deps.conversations.updateState(
      input.tenantId,
      input.conversationId,
      'REQUIRES_HUMAN',
    );

    await this.deps.audit.append({
      tenantId: input.tenantId,
      actorType: 'bot',
      action: 'ticket_created',
      entityType: 'human_ticket',
      entityId: ticket.id,
      metadata: { reason: input.reason, slaMinutes: this.deps.slaMinutes },
    });

    const owners = await this.deps.channels.listOwners(input.tenantId);

    try {
      const { deliveredTo } = await this.deps.notifier.notifyTicket(ticket, owners);
      if (deliveredTo.length === 0) {
        return ticket;
      }

      await this.deps.tickets.addEvent({
        tenantId: input.tenantId,
        ticketId: ticket.id,
        event: 'notified',
        actorType: 'bot',
      });
      await this.deps.tickets.updateStatus(input.tenantId, ticket.id, 'notified');
      ticket = { ...ticket, status: 'notified' };
    } catch {
      // The ticket stays open; Phase 3's SLA/fallback job picks it up.
    }

    return ticket;
  }
}
