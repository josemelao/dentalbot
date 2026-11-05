import { ChannelAdapter } from '../channels/channel-adapter';
import { DomainError } from '../common/errors';
import { NormalizedMessage } from '../contracts/normalized-message';
import { ProcessingResult, ProcessingStatus } from '../contracts/processing-result';
import { AuditRepository } from '../db/repositories/audit.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { Conversation, Message, PatientContact } from '../db/repositories/rows';
import { TicketsRepository } from '../db/repositories/tickets.repository';
import { Decision } from './decision';
import { EscalationService } from './escalation.service';
import { FaqService } from './faq.service';
import { IdentityService } from './identity.service';
import { IntentService } from './intent.service';
import { ResponseComposer } from './composer.service';
import { SafetyService } from './safety.service';

export interface InboundContext {
  tenantId: string;
  correlationId: string;
  normalized: NormalizedMessage;
  contact: PatientContact;
  conversation: Conversation;
  inboundMessage: Message;
  recentMessages: Message[];
  humanActive: boolean;
}

export interface InboundDependencies {
  identity: IdentityService;
  conversations: ConversationsRepository;
  messages: MessagesRepository;
  tickets: TicketsRepository;
  audit: AuditRepository;
  safety: SafetyService;
  intent: IntentService;
  faq: FaqService;
  escalation: EscalationService;
  composer: ResponseComposer;
  channel: ChannelAdapter;
  slaMinutes: number;
}

export class InboundService {
  constructor(private readonly deps: InboundDependencies) {}

  async handle(
    normalized: NormalizedMessage,
    correlationId: string,
  ): Promise<ProcessingResult<InboundContext>> {
    try {
      const { contact, conversation, recentMessages } = await this.deps.identity.resolve(normalized);

      const inboundMessage = await this.deps.messages.appendInbound({
        tenantId: normalized.tenantId,
        conversationId: conversation.id,
        channel: normalized.channel,
        externalMessageId: normalized.externalMessageId,
        messageType: normalized.messageType,
        content: normalized.content,
        media: normalized.media,
      });

      await this.deps.conversations.touchInbound(
        normalized.tenantId,
        conversation.id,
        normalized.receivedAt,
      );

      await this.deps.audit.append({
        tenantId: normalized.tenantId,
        actorType: 'patient',
        action: 'inbound_message_received',
        entityType: 'message',
        entityId: inboundMessage.id,
        metadata: {
          channel: normalized.channel,
          messageType: normalized.messageType,
        },
        correlationId,
      });

      const openTicket = await this.deps.tickets.findOpenByConversation(
        normalized.tenantId,
        conversation.id,
      );

      if (openTicket) {
        await this.deps.conversations.updateState(
          normalized.tenantId,
          conversation.id,
          'HUMAN_ACTIVE',
        );
        await this.deps.audit.append({
          tenantId: normalized.tenantId,
          actorType: 'system',
          action: 'human_active_no_reply',
          entityType: 'conversation',
          entityId: conversation.id,
          correlationId,
        });

        return {
          success: true,
          status: 'REQUIRES_HUMAN',
          data: {
            tenantId: normalized.tenantId,
            correlationId,
            normalized,
            contact,
            conversation: { ...conversation, state: 'HUMAN_ACTIVE' as const },
            inboundMessage,
            recentMessages,
            humanActive: true,
          },
          error: null,
          correlationId,
        };
      }

      const decision = await this.decide(normalized, conversation, inboundMessage, recentMessages);
      const outboundText = this.deps.composer.compose(decision, {
        slaMinutes: this.deps.slaMinutes,
      });

      let status: ProcessingStatus = 'COMPLETED';
      if (decision.kind === 'HOLDING_ESCALATED' || decision.kind === 'EMERGENCY_PROTOCOL') {
        status = 'REQUIRES_HUMAN';
      }

      if (outboundText !== null) {
        try {
          await this.deps.channel.send({
            externalUserId: normalized.externalUserId,
            text: outboundText,
          });

          const outboundMessage = await this.deps.messages.appendOutbound({
            tenantId: normalized.tenantId,
            conversationId: conversation.id,
            channel: normalized.channel,
            content: outboundText,
            deliveryStatus: 'sent',
          });

          await this.deps.conversations.touchOutbound(
            normalized.tenantId,
            conversation.id,
            new Date(),
          );

          await this.deps.audit.append({
            tenantId: normalized.tenantId,
            actorType: 'bot',
            action: 'outbound_message_sent',
            entityType: 'message',
            entityId: outboundMessage.id,
            metadata: { decision: decision.kind },
            correlationId,
          });
        } catch {
          await this.deps.messages.appendOutbound({
            tenantId: normalized.tenantId,
            conversationId: conversation.id,
            channel: normalized.channel,
            content: outboundText,
            deliveryStatus: 'failed',
          });

          await this.deps.audit.append({
            tenantId: normalized.tenantId,
            actorType: 'bot',
            action: 'outbound_message_failed',
            entityType: 'conversation',
            entityId: conversation.id,
            metadata: { decision: decision.kind },
            correlationId,
          });

          status = 'UNKNOWN';
        }
      }

      return {
        success: true,
        status,
        data: {
          tenantId: normalized.tenantId,
          correlationId,
          normalized,
          contact,
          conversation,
          inboundMessage,
          recentMessages,
          humanActive: false,
        },
        error: null,
        correlationId,
      };
    } catch (error) {
      if (error instanceof DomainError) {
        return {
          success: false,
          status: 'FAILED',
          data: null,
          error: { code: error.code, message: error.message, retryable: false },
          correlationId,
        };
      }
      throw error;
    }
  }

  private async decide(
    normalized: NormalizedMessage,
    conversation: Conversation,
    inboundMessage: Message,
    recentMessages: Message[],
  ): Promise<Decision> {
    const text = normalized.content ?? '';

    if (normalized.messageType !== 'text' || text.trim().length === 0) {
      return { kind: 'UNSUPPORTED_MEDIA' };
    }

    const triage = this.deps.safety.triage(text);

    if (triage.tier === 'EMERGENCY') {
      try {
        await this.deps.escalation.create({
          tenantId: normalized.tenantId,
          conversationId: conversation.id,
          patientContactId: conversation.patientContactId,
          reason: 'EMERGENCY',
          summary: 'Possível emergência odontológica',
          question: text,
        });
      } catch {
        // The safety reply must go out even if the ticket cannot be persisted.
      }
      return { kind: 'EMERGENCY_PROTOCOL', rule: triage.matchedRule ?? 'deterministic_emergency' };
    }

    const classified = await this.deps.intent.classify({
      tenantId: normalized.tenantId,
      conversationId: conversation.id,
      messageId: inboundMessage.id,
      text,
      recentMessages: recentMessages.map((message) => ({
        direction: message.direction,
        content: message.content,
      })),
    });
    const tier = this.deps.safety.escalate(triage, classified.intent).tier;

    if (tier === 'EMERGENCY') {
      try {
        await this.deps.escalation.create({
          tenantId: normalized.tenantId,
          conversationId: conversation.id,
          patientContactId: conversation.patientContactId,
          reason: 'EMERGENCY',
          summary: 'Possível emergência odontológica',
          question: text,
        });
      } catch {
        // The safety reply must go out even if the ticket cannot be persisted.
      }
      return { kind: 'EMERGENCY_PROTOCOL', rule: triage.matchedRule ?? 'intent_emergency' };
    }

    if (tier === 'CLINICAL') {
      const ticket = await this.deps.escalation.create({
        tenantId: normalized.tenantId,
        conversationId: conversation.id,
        patientContactId: conversation.patientContactId,
        reason: 'CLINICAL',
        summary: 'Dúvida clínica',
        question: text,
      });
      return { kind: 'HOLDING_ESCALATED', ticket };
    }

    if (classified.intent === 'HUMAN_REQUEST') {
      const ticket = await this.deps.escalation.create({
        tenantId: normalized.tenantId,
        conversationId: conversation.id,
        patientContactId: conversation.patientContactId,
        reason: 'HUMAN_REQUEST',
        summary: 'Paciente pediu atendimento humano',
        question: text,
      });
      return { kind: 'HOLDING_ESCALATED', ticket };
    }

    if (classified.intent === 'FAQ_ADMIN') {
      const answer = await this.deps.faq.answer(normalized.tenantId, text);
      if (answer.found) {
        return { kind: 'ANSWER_FAQ', entry: answer.entry };
      }

      const ticket = await this.deps.escalation.create({
        tenantId: normalized.tenantId,
        conversationId: conversation.id,
        patientContactId: conversation.patientContactId,
        reason: 'UNKNOWN',
        summary: 'Pergunta administrativa sem resposta aprovada',
        question: text,
      });
      return { kind: 'HOLDING_ESCALATED', ticket };
    }

    if (
      classified.intent === 'SCHEDULE_REQUEST' ||
      classified.intent === 'RESCHEDULE_REQUEST' ||
      classified.intent === 'CANCEL_REQUEST'
    ) {
      const ticket = await this.deps.escalation.create({
        tenantId: normalized.tenantId,
        conversationId: conversation.id,
        patientContactId: conversation.patientContactId,
        reason: 'UNKNOWN',
        summary: 'Agendamento ainda não habilitado nesta fase',
        question: text,
      });
      return { kind: 'HOLDING_ESCALATED', ticket };
    }

    if (classified.intent === 'GREETING') {
      return { kind: 'GREETING' };
    }

    const ticket = await this.deps.escalation.create({
      tenantId: normalized.tenantId,
      conversationId: conversation.id,
      patientContactId: conversation.patientContactId,
      reason: 'UNKNOWN',
      summary: 'Mensagem não classificada',
      question: text,
    });
    return { kind: 'HOLDING_ESCALATED', ticket };
  }
}
