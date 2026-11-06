import { OwnerNotifier } from '../channels/owner-notifier';
import { ChannelAdapter } from '../channels/channel-adapter';
import { Channel } from '../contracts/channel';
import { AuditRepository } from '../db/repositories/audit.repository';
import { ChannelsRepository } from '../db/repositories/channels.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { HumanTicket, TicketReason } from '../db/repositories/rows';
import { TicketsRepository } from '../db/repositories/tickets.repository';
import { formatPatientLabel, formatTicketCard } from './ticket-card';

export interface EscalationDependencies {
  tickets: TicketsRepository;
  channels: ChannelsRepository;
  conversations: ConversationsRepository;
  patients: PatientsRepository;
  messages: MessagesRepository;
  audit: AuditRepository;
  notifier: OwnerNotifier;
  ownerChannel: Channel;
  channel: ChannelAdapter;
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
    if (existing) {
      return this.escalateExisting({
        tenantId: input.tenantId,
        ticket: existing,
        reason: input.reason,
        summary: input.summary,
      });
    }

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

    const recipients = await this.deps.channels.listOwnerRecipients(
      input.tenantId,
      this.deps.ownerChannel,
    );
    const contact = await this.deps.patients.findContactById(
      input.tenantId,
      input.patientContactId,
    );
    const patientLabel = formatPatientLabel(contact?.displayName, contact?.externalUserId ?? '');

    try {
      const { deliveredTo } = await this.deps.notifier.notify(
        { ticket, patientLabel, text: formatTicketCard(ticket, patientLabel) },
        recipients,
      );
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

  /** Warns the owners that an accepted ticket is waiting without a reply. */
  async notifyIdle(
    ticket: HumanTicket,
    minutes: number,
  ): Promise<{ deliveredTo: string[] }> {
    const recipients = await this.deps.channels.listOwnerRecipients(
      ticket.tenantId,
      this.deps.ownerChannel,
    );
    if (recipients.length === 0) return { deliveredTo: [] };

    const contact = await this.deps.patients.findContactById(
      ticket.tenantId,
      ticket.patientContactId,
    );
    const patientLabel = formatPatientLabel(contact?.displayName, contact?.externalUserId ?? '');

    const text = [
      `[TICKET #${ticket.id.slice(0, 8)}] ${patientLabel}`,
      `Assumido há ${minutes} min sem resposta — o paciente está esperando.`,
      'Responda 1/2/3 ou use o painel.',
    ].join('\n');

    const { deliveredTo } = await this.deps.notifier.notify(
      { ticket, patientLabel, text },
      recipients,
    );

    if (deliveredTo.length > 0) {
      await this.deps.tickets.addEvent({
        tenantId: ticket.tenantId,
        ticketId: ticket.id,
        event: 'idle_alert',
        actorType: 'bot',
        metadata: { minutes },
      });
      await this.deps.audit.append({
        tenantId: ticket.tenantId,
        actorType: 'bot',
        action: 'ticket_idle_alert',
        entityType: 'human_ticket',
        entityId: ticket.id,
        metadata: { minutes },
      });
    }

    return { deliveredTo };
  }

  /** Re-sends the card for an already-open ticket (used when an owner is linked later). */
  async renotify(ticket: HumanTicket): Promise<{ deliveredTo: string[] }> {
    const recipients = await this.deps.channels.listOwnerRecipients(
      ticket.tenantId,
      this.deps.ownerChannel,
    );
    if (recipients.length === 0) return { deliveredTo: [] };

    const contact = await this.deps.patients.findContactById(
      ticket.tenantId,
      ticket.patientContactId,
    );
    const patientLabel = formatPatientLabel(contact?.displayName, contact?.externalUserId ?? '');

    return this.deps.notifier.notify(
      { ticket, patientLabel, text: formatTicketCard(ticket, patientLabel) },
      recipients,
    );
  }

  /** Sends a human answer to the patient and records it on the ticket. */
  async reply(input: {
    tenantId: string;
    ticket: HumanTicket;
    userId: string | null;
    text: string;
    correlationId?: string | null;
  }): Promise<void> {
    const contact = await this.deps.patients.findContactById(
      input.tenantId,
      input.ticket.patientContactId,
    );
    if (!contact) throw new Error('Ticket contact not found');

    await this.deps.channel.send({ externalUserId: contact.externalUserId, text: input.text });

    await this.deps.messages.appendOutbound({
      tenantId: input.tenantId,
      conversationId: input.ticket.conversationId,
      channel: contact.channel,
      content: input.text,
      deliveryStatus: 'sent',
    });

    await this.deps.conversations.touchOutbound(
      input.tenantId,
      input.ticket.conversationId,
      new Date(),
    );

    await this.deps.tickets.answer(input.tenantId, input.ticket.id, input.text, input.userId);
    await this.deps.tickets.addEvent({
      tenantId: input.tenantId,
      ticketId: input.ticket.id,
      event: 'answered',
      actorType: 'human',
      actorId: input.userId,
    });
    await this.deps.audit.append({
      tenantId: input.tenantId,
      actorType: 'human',
      actorId: input.userId,
      action: 'ticket_answered',
      entityType: 'human_ticket',
      entityId: input.ticket.id,
      correlationId: input.correlationId ?? null,
    });
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

  /**
   * The human took over. This is the only thing that makes the bot go quiet;
   * an open ticket alone does not.
   */
  async accept(input: {
    tenantId: string;
    ticket: HumanTicket;
    userId: string | null;
  }): Promise<HumanTicket> {
    if (input.ticket.acceptedAt) return input.ticket;

    await this.deps.tickets.accept(input.tenantId, input.ticket.id, input.userId);
    await this.deps.tickets.addEvent({
      tenantId: input.tenantId,
      ticketId: input.ticket.id,
      event: 'accepted',
      actorType: 'human',
      actorId: input.userId,
    });
    await this.deps.conversations.updateState(
      input.tenantId,
      input.ticket.conversationId,
      'HUMAN_ACTIVE',
    );
    await this.deps.audit.append({
      tenantId: input.tenantId,
      actorType: 'human',
      actorId: input.userId,
      action: 'ticket_accepted',
      entityType: 'human_ticket',
      entityId: input.ticket.id,
    });

    return { ...input.ticket, acceptedAt: new Date(), acceptedBy: input.userId };
  }

  /** Closing the ticket hands the conversation back to the bot. */
  async resolve(input: { tenantId: string; ticket: HumanTicket }): Promise<HumanTicket> {
    await this.deps.tickets.resolve(input.tenantId, input.ticket.id);
    await this.deps.tickets.addEvent({
      tenantId: input.tenantId,
      ticketId: input.ticket.id,
      event: 'resolved',
      actorType: 'human',
    });
    await this.deps.conversations.updateState(
      input.tenantId,
      input.ticket.conversationId,
      'ACTIVE',
    );
    await this.deps.audit.append({
      tenantId: input.tenantId,
      actorType: 'human',
      action: 'ticket_resolved',
      entityType: 'human_ticket',
      entityId: input.ticket.id,
    });

    return { ...input.ticket, status: 'resolved' };
  }
}
