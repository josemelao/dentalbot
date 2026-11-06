import { NormalizedMessage } from '../contracts/normalized-message';
import { ChannelsRepository } from '../db/repositories/channels.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { Conversation, Message, PatientContact } from '../db/repositories/rows';
import { DomainError } from '../common/errors';

export interface IdentityDependencies {
  channels: ChannelsRepository;
  patients: PatientsRepository;
  conversations: ConversationsRepository;
  messages: MessagesRepository;
}

export interface ResolvedIdentity {
  contact: PatientContact;
  conversation: Conversation;
  recentMessages: Message[];
}

export class IdentityService {
  constructor(private readonly deps: IdentityDependencies) {}

  async resolve(normalized: NormalizedMessage): Promise<ResolvedIdentity> {
    const channel = await this.deps.channels.findByExternalId(
      normalized.channel,
      normalized.externalChannelId,
    );

    if (!channel || channel.tenantId !== normalized.tenantId) {
      throw new DomainError('CHANNEL_NOT_FOUND', 404, 'Channel is not configured');
    }

    let contact = await this.deps.patients.findContact(
      normalized.tenantId,
      normalized.channel,
      normalized.externalUserId,
    );

    if (!contact) {
      contact = await this.deps.patients.createProvisionalContact({
        tenantId: normalized.tenantId,
        channel: normalized.channel,
        externalUserId: normalized.externalUserId,
        displayName: normalized.displayName ?? null,
      });
    } else if (!contact.displayName && normalized.displayName) {
      // Telegram gives us the profile name; keep the card and the day list human.
      await this.deps.patients.updateDisplayName(
        normalized.tenantId,
        contact.id,
        normalized.displayName,
      );
      contact = { ...contact, displayName: normalized.displayName };
    }

    let conversation = await this.deps.conversations.findOpenByContact(
      normalized.tenantId,
      contact.id,
    );

    if (!conversation) {
      conversation = await this.deps.conversations.create({
        tenantId: normalized.tenantId,
        patientContactId: contact.id,
        channel: normalized.channel,
      });
    }

    const recentMessages = await this.deps.messages.listRecent(
      normalized.tenantId,
      conversation.id,
      20,
    );

    return { contact, conversation, recentMessages };
  }
}
