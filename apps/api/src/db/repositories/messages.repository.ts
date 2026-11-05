import { Channel, MessageType } from '../../contracts/channel';
import { Queryable } from '../pool';
import { Message } from './rows';

export interface AppendInboundInput {
  tenantId: string;
  conversationId: string;
  channel: Channel;
  externalMessageId: string;
  messageType: MessageType;
  content: string | null;
  media: unknown;
}

export interface AppendOutboundInput {
  tenantId: string;
  conversationId: string;
  channel: Channel;
  content: string;
  deliveryStatus?: 'sent' | 'failed';
}

const MESSAGE_COLUMNS = `id, tenant_id as "tenantId", conversation_id as "conversationId",
  channel, direction, external_message_id as "externalMessageId",
  message_type as "messageType", content, media,
  delivery_status as "deliveryStatus", created_at as "createdAt"`;

export class MessagesRepository {
  constructor(private readonly db: Queryable) {}

  async appendInbound(input: AppendInboundInput): Promise<Message> {
    const { rows } = await this.db.query(
      `insert into messages
         (tenant_id, conversation_id, channel, direction, external_message_id,
          message_type, content, media, delivery_status)
       values ($1, $2, $3, 'in', $4, $5, $6, $7, 'received')
       returning ${MESSAGE_COLUMNS}`,
      [
        input.tenantId,
        input.conversationId,
        input.channel,
        input.externalMessageId,
        input.messageType,
        input.content,
        input.media,
      ],
    );
    return rows[0] as Message;
  }

  async appendOutbound(input: AppendOutboundInput): Promise<Message> {
    const { rows } = await this.db.query(
      `insert into messages
         (tenant_id, conversation_id, channel, direction, external_message_id,
          message_type, content, media, delivery_status)
       values ($1, $2, $3, 'out', null, 'text', $4, null, $5)
       returning ${MESSAGE_COLUMNS}`,
      [
        input.tenantId,
        input.conversationId,
        input.channel,
        input.content,
        input.deliveryStatus ?? 'sent',
      ],
    );
    return rows[0] as Message;
  }

  async listRecent(
    tenantId: string,
    conversationId: string,
    limit: number,
  ): Promise<Message[]> {
    const { rows } = await this.db.query(
      `select * from (
         select ${MESSAGE_COLUMNS}
         from messages
         where tenant_id = $1 and conversation_id = $2
         order by created_at desc, id desc
         limit $3
       ) recent
       order by "createdAt" asc`,
      [tenantId, conversationId, limit],
    );
    return rows as Message[];
  }
}
