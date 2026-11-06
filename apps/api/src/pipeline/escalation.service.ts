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

export interface EscalateExistingInput {
  tenantId: string;
  ticket: HumanTicket;
  reason: TicketReason;
  summary: string;
}

/** Higher wins. A clinical or emergency signal must never be hidden by a weaker ticket. */
const REASON_PRIORITY: Record<TicketReason, number> = {
  UNKNOWN: 1,
  HUMAN_REQUEST: 2,
  CLINICAL: 3,
  EMERGENCY: 4,
};

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

  /**
   * Upgrades an already-open ticket when a stronger signal arrives.
   *
   * A conversation keeps a single open ticket (see `one_open_ticket_per_conversation`),
   * so a later "estou com dor" or emergency must not be dropped just because an
   * UNKNOWN ticket is already open. We raise the reason, restart the SLA clock and
   * leave an audit trail. A weaker signal never downgrades a stronger ticket.
   */
  async escalateExisting(input: EscalateExistingInput): Promise<HumanTicket> {
    const current = input.ticket;
    if (REASON_PRIORITY[input.reason] <= REASON_PRIORITY[current.reason]) {
      return current;
    }

    const slaDueAt = new Date(Date.now() + this.deps.slaMinutes * 60_000);

    await this.deps.tickets.reclassify(
      input.tenantId,
      current.id,
      input.reason,
      input.summary,
      slaDueAt,
    );

    await this.deps.tickets.addEvent({
      tenantId: input.tenantId,
      ticketId: current.id,
      event: 'reclassified',
      actorType: 'bot',
      metadata: { from: current.reason, to: input.reason },
    });

    await this.deps.audit.append({
      tenantId: input.tenantId,
      actorType: 'bot',
      action: 'ticket_reclassified',
      entityType: 'human_ticket',
      entityId: current.id,
      metadata: { from: current.reason, to: input.reason, slaMinutes: this.deps.slaMinutes },
    });

    return { ...current, reason: input.reason, summary: input.summary, slaDueAt };
  }
}
