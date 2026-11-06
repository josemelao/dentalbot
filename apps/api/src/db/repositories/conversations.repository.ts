import { Channel } from '../../contracts/channel';
import { Queryable } from '../pool';
import { Conversation, ConversationState } from './rows';

export interface CreateConversationInput {
  tenantId: string;
  patientContactId: string;
  channel: Channel;
}

export class ConversationsRepository {
  constructor(private readonly db: Queryable) {}

  async findOpenByContact(
    tenantId: string,
    patientContactId: string,
  ): Promise<Conversation | null> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", patient_contact_id as "patientContactId", channel,
              state, human_ticket_id as "humanTicketId", context
       from conversations
       where tenant_id = $1 and patient_contact_id = $2 and state <> 'CLOSED'
       order by created_at desc
       limit 1`,
      [tenantId, patientContactId],
    );
    return (rows[0] as Conversation | undefined) ?? null;
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    const { rows } = await this.db.query(
      `insert into conversations (tenant_id, patient_contact_id, channel)
       values ($1, $2, $3)
       returning id, tenant_id as "tenantId", patient_contact_id as "patientContactId", channel,
                 state, human_ticket_id as "humanTicketId", context`,
      [input.tenantId, input.patientContactId, input.channel],
    );
    return rows[0] as Conversation;
  }

  async updateState(
    tenantId: string,
    conversationId: string,
    state: ConversationState,
  ): Promise<void> {
    await this.db.query(
      `update conversations set state = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, conversationId, state],
    );
  }

  async touchInbound(tenantId: string, conversationId: string, at: Date): Promise<void> {
    await this.db.query(
      `update conversations set last_inbound_at = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, conversationId, at],
    );
  }

  async touchOutbound(tenantId: string, conversationId: string, at: Date): Promise<void> {
    await this.db.query(
      `update conversations set last_outbound_at = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, conversationId, at],
    );
  }

  /** Marks the conversation as read in the panel (operator side only). */
  async markPanelRead(
    tenantId: string,
    conversationId: string,
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `update conversations set panel_read_at = $3
       where tenant_id = $1 and id = $2`,
      [tenantId, conversationId, at],
    );
  }

  async updateContext(
    tenantId: string,
    conversationId: string,
    context: object | null,
  ): Promise<void> {
    await this.db.query(
      `update conversations set context = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, conversationId, context ?? {}],
    );
  }
}
