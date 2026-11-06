import { ChannelAdapter } from '../channels/channel-adapter';
import { AuditRepository } from '../db/repositories/audit.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { TicketsRepository } from '../db/repositories/tickets.repository';

export const SLA_FALLBACK_TEXT =
  'Ainda estou confirmando isso com a equipe. Enquanto isso posso ajudar com horários, endereço ou agendamento — é só me dizer.';

export interface SlaDependencies {
  tickets: TicketsRepository;
  messages: MessagesRepository;
  conversations: ConversationsRepository;
  patients: PatientsRepository;
  audit: AuditRepository;
  channel: ChannelAdapter;
  now: () => Date;
}

export interface SlaSweepResult {
  tenantId: string;
  overdue: number;
  delivered: number;
  failed: number;
}

/**
 * The SLA guarantee from the blueprint: a patient never stays without an answer.
 *
 * If nobody accepted the ticket by `sla_due_at`, the bot sends a safe next step
 * instead of silence. The ticket stays open for the human and the `fallback`
 * event prevents the same ticket from being chased twice.
 */
export class SlaService {
  constructor(private readonly deps: SlaDependencies) {}

  async sweepTenant(tenantId: string): Promise<SlaSweepResult> {
    const now = this.deps.now();
    const overdue = await this.deps.tickets.listOverdue(tenantId, now);

    let delivered = 0;
    let failed = 0;

    for (const ticket of overdue) {
      const contact = await this.deps.patients.findContactById(
        tenantId,
        ticket.patientContactId,
      );
      if (!contact) {
        failed += 1;
        continue;
      }

      try {
        await this.deps.channel.send({
          externalUserId: contact.externalUserId,
          text: SLA_FALLBACK_TEXT,
        });

        await this.deps.messages.appendOutbound({
          tenantId,
          conversationId: ticket.conversationId,
          channel: contact.channel,
          content: SLA_FALLBACK_TEXT,
          deliveryStatus: 'sent',
        });

        await this.deps.conversations.touchOutbound(tenantId, ticket.conversationId, now);

        await this.deps.tickets.addEvent({
          tenantId,
          ticketId: ticket.id,
          event: 'fallback',
          actorType: 'bot',
          metadata: { slaDueAt: ticket.slaDueAt },
        });

        await this.deps.audit.append({
          tenantId,
          actorType: 'bot',
          action: 'sla_fallback_sent',
          entityType: 'human_ticket',
          entityId: ticket.id,
        });

        delivered += 1;
      } catch {
        failed += 1;
      }
    }

    return { tenantId, overdue: overdue.length, delivered, failed };
  }
}
