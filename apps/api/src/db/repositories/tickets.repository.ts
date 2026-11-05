import { Queryable } from '../pool';
import { HumanTicket } from './rows';

export class TicketsRepository {
  constructor(private readonly db: Queryable) {}

  async findOpenByConversation(
    tenantId: string,
    conversationId: string,
  ): Promise<HumanTicket | null> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", conversation_id as "conversationId",
              patient_contact_id as "patientContactId", status, reason, summary, question,
              options, answer, sla_due_at as "slaDueAt"
       from human_tickets
       where tenant_id = $1 and conversation_id = $2
         and status in ('open', 'notified', 'answered')
       order by created_at desc
       limit 1`,
      [tenantId, conversationId],
    );
    return (rows[0] as HumanTicket | undefined) ?? null;
  }
}
