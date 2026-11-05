import { NormalizedMessage } from '../contracts/normalized-message';
import { ProcessingResult } from '../contracts/processing-result';
import { DomainError } from '../common/errors';
import { AuditRepository } from '../db/repositories/audit.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { Conversation, Message, PatientContact } from '../db/repositories/rows';
import { TicketsRepository } from '../db/repositories/tickets.repository';
import { IdentityService } from './identity.service';

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

      const openTicket = await this.deps.tickets.findOpenByConversation(
        normalized.tenantId,
        conversation.id,
      );
      const humanActive = openTicket !== null;
      if (humanActive) {
        await this.deps.conversations.updateState(
          normalized.tenantId,
          conversation.id,
          'HUMAN_ACTIVE',
        );
      }

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

      const context: InboundContext = {
        tenantId: normalized.tenantId,
        correlationId,
        normalized,
        contact,
        conversation: humanActive
          ? { ...conversation, state: 'HUMAN_ACTIVE' as const }
          : conversation,
        inboundMessage,
        recentMessages,
        humanActive,
      };

      return {
        success: true,
        status: 'PENDING',
        data: context,
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
}
