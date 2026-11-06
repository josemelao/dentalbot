import { ChannelAdapter } from '../channels/channel-adapter';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { PendingRepliesRepository } from '../db/repositories/pending-replies.repository';
import { Queryable } from '../db/pool';

export class ShadowModeService {
  constructor(private readonly db: Queryable) {}

  async isEnabled(tenantId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `select shadow_mode as enabled from clinics where id = $1`,
      [tenantId],
    );
    return (rows[0] as { enabled: boolean } | undefined)?.enabled ?? false;
  }

  async setEnabled(tenantId: string, enabled: boolean): Promise<void> {
    await this.db.query(`update clinics set shadow_mode = $2 where id = $1`, [
      tenantId,
      enabled,
    ]);
  }
}

export interface PendingReplyDependencies {
  pending: PendingRepliesRepository;
  messages: MessagesRepository;
  conversations: ConversationsRepository;
  patients: PatientsRepository;
  channel: ChannelAdapter;
}

/**
 * Shadow mode queue: the bot drafts, a human approves. Nothing reaches the
 * patient until someone decides, except the emergency protocol, which always
 * bypasses this path.
 */
export class PendingReplyService {
  constructor(private readonly deps: PendingReplyDependencies) {}

  async enqueue(input: {
    tenantId: string;
    conversationId: string;
    patientContactId: string;
    content: string;
  }): Promise<void> {
    await this.deps.pending.create(input);
  }

  async approve(input: {
    tenantId: string;
    id: string;
    userId: string | null;
    content?: string;
  }): Promise<'sent' | 'not_found'> {
    const pending = await this.deps.pending.findById(input.tenantId, input.id);
    if (!pending || pending.status !== 'PENDING') return 'not_found';

    const contact = await this.deps.patients.findContactById(
      input.tenantId,
      pending.patientContactId,
    );
    if (!contact) return 'not_found';

    const text = (input.content ?? pending.content).trim();
    if (text.length === 0) return 'not_found';

    await this.deps.channel.send({ externalUserId: contact.externalUserId, text });
    await this.deps.messages.appendOutbound({
      tenantId: input.tenantId,
      conversationId: pending.conversationId,
      channel: contact.channel,
      content: text,
      deliveryStatus: 'sent',
    });
    await this.deps.conversations.touchOutbound(
      input.tenantId,
      pending.conversationId,
      new Date(),
    );
    await this.deps.pending.decide(input.tenantId, input.id, 'SENT', input.userId);

    return 'sent';
  }

  async discard(input: {
    tenantId: string;
    id: string;
    userId: string | null;
  }): Promise<'discarded' | 'not_found'> {
    const pending = await this.deps.pending.findById(input.tenantId, input.id);
    if (!pending || pending.status !== 'PENDING') return 'not_found';

    await this.deps.pending.decide(input.tenantId, input.id, 'DISCARDED', input.userId);
    return 'discarded';
  }
}
