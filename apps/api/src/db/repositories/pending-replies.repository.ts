import { Queryable } from '../pool';

export interface PendingReply {
  id: string;
  tenantId: string;
  conversationId: string;
  patientContactId: string;
  content: string;
  status: 'PENDING' | 'SENT' | 'DISCARDED';
  createdAt: Date;
}

const COLUMNS = `id, tenant_id as "tenantId", conversation_id as "conversationId",
  patient_contact_id as "patientContactId", content, status, created_at as "createdAt"`;

export class PendingRepliesRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: {
    tenantId: string;
    conversationId: string;
    patientContactId: string;
    content: string;
  }): Promise<PendingReply> {
    const { rows } = await this.db.query(
      `insert into pending_replies (tenant_id, conversation_id, patient_contact_id, content)
       values ($1, $2, $3, $4)
       returning ${COLUMNS}`,
      [input.tenantId, input.conversationId, input.patientContactId, input.content],
    );
    return rows[0] as PendingReply;
  }

  async listPending(
    tenantId: string,
    limit = 50,
  ): Promise<Array<PendingReply & { patientLabel: string | null; externalUserId: string }>> {
    const { rows } = await this.db.query(
      `select ${COLUMNS},
              (select pc.display_name from patient_contacts pc
                where pc.tenant_id = pending_replies.tenant_id
                  and pc.id = pending_replies.patient_contact_id) as "patientLabel",
              (select pc.external_user_id from patient_contacts pc
                where pc.tenant_id = pending_replies.tenant_id
                  and pc.id = pending_replies.patient_contact_id) as "externalUserId"
       from pending_replies
       where tenant_id = $1 and status = 'PENDING'
       order by created_at
       limit $2`,
      [tenantId, limit],
    );
    return rows as Array<
      PendingReply & { patientLabel: string | null; externalUserId: string }
    >;
  }

  async findById(tenantId: string, id: string): Promise<PendingReply | null> {
    const { rows } = await this.db.query(
      `select ${COLUMNS} from pending_replies where tenant_id = $1 and id = $2`,
      [tenantId, id],
    );
    return (rows[0] as PendingReply | undefined) ?? null;
  }

  async decide(
    tenantId: string,
    id: string,
    status: 'SENT' | 'DISCARDED',
    userId: string | null,
  ): Promise<void> {
    await this.db.query(
      `update pending_replies
       set status = $3, decided_at = now(), decided_by = $4
       where tenant_id = $1 and id = $2 and status = 'PENDING'`,
      [tenantId, id, status, userId],
    );
  }
}
