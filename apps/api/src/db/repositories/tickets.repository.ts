import { Queryable } from '../pool';
import { HumanTicket, TicketEvent, TicketReason, TicketStatus } from './rows';

export interface CreateTicketInput {
  tenantId: string;
  conversationId: string;
  patientContactId: string;
  reason: TicketReason;
  summary: string;
  question: string;
  options?: unknown;
  slaDueAt: Date;
}

export interface AddTicketEventInput {
  tenantId: string;
  ticketId: string;
  event: TicketEvent;
  actorType: string;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}

const TICKET_COLUMNS = `id, tenant_id as "tenantId", conversation_id as "conversationId",
  patient_contact_id as "patientContactId", status, reason, summary, question,
  options, answer, sla_due_at as "slaDueAt"`;

export class TicketsRepository {
  constructor(private readonly db: Queryable) {}

  async findOpenByConversation(
    tenantId: string,
    conversationId: string,
  ): Promise<HumanTicket | null> {
    const { rows } = await this.db.query(
      `select ${TICKET_COLUMNS}
       from human_tickets
       where tenant_id = $1 and conversation_id = $2
         and status in ('open', 'notified', 'answered')
       order by created_at desc
       limit 1`,
      [tenantId, conversationId],
    );
    return (rows[0] as HumanTicket | undefined) ?? null;
  }

  async create(input: CreateTicketInput): Promise<{ ticket: HumanTicket; created: boolean }> {
    const { rows } = await this.db.query(
      `insert into human_tickets
         (tenant_id, conversation_id, patient_contact_id, reason, summary, question, options, sla_due_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (tenant_id, conversation_id)
         where status in ('open', 'notified', 'answered')
       do nothing
       returning ${TICKET_COLUMNS}`,
      [
        input.tenantId,
        input.conversationId,
        input.patientContactId,
        input.reason,
        input.summary,
        input.question,
        input.options ?? [],
        input.slaDueAt,
      ],
    );

    if (rows[0]) {
      return { ticket: rows[0] as HumanTicket, created: true };
    }

    const existing = await this.findOpenByConversation(input.tenantId, input.conversationId);
    if (!existing) {
      throw new Error('Failed to create or find the open ticket');
    }
    return { ticket: existing, created: false };
  }

  async addEvent(input: AddTicketEventInput): Promise<void> {
    await this.db.query(
      `insert into ticket_events
         (tenant_id, ticket_id, event, actor_type, actor_id, metadata)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        input.tenantId,
        input.ticketId,
        input.event,
        input.actorType,
        input.actorId ?? null,
        input.metadata ?? {},
      ],
    );
  }

  async updateStatus(
    tenantId: string,
    ticketId: string,
    status: TicketStatus,
  ): Promise<void> {
    await this.db.query(
      `update human_tickets set status = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, ticketId, status],
    );
  }
}
