import { Queryable } from '../pool';

export interface ProposalSlot {
  startAt: string;
  professionalIds: string[];
  resourceId: string | null;
}

export interface RescheduleProposal {
  id: string;
  tenantId: string;
  appointmentId: string;
  conversationId: string;
  slots: ProposalSlot[];
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';
  expiresAt: Date;
}

const COLUMNS = `id, tenant_id as "tenantId", appointment_id as "appointmentId",
  conversation_id as "conversationId", slots, status, expires_at as "expiresAt"`;

export class RescheduleProposalRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: {
    tenantId: string;
    appointmentId: string;
    conversationId: string;
    slots: ProposalSlot[];
    expiresAt: Date;
    createdBy: string | null;
  }): Promise<RescheduleProposal> {
    const { rows } = await this.db.query(
      `insert into reschedule_proposals
         (tenant_id, appointment_id, conversation_id, slots, expires_at, created_by)
       values ($1, $2, $3, $4, $5, $6)
       returning ${COLUMNS}`,
      [
        input.tenantId,
        input.appointmentId,
        input.conversationId,
        JSON.stringify(input.slots),
        input.expiresAt,
        input.createdBy,
      ],
    );
    return rows[0] as RescheduleProposal;
  }

  async findLatestByConversation(
    tenantId: string,
    conversationId: string,
  ): Promise<RescheduleProposal | null> {
    const { rows } = await this.db.query(
      `select ${COLUMNS}
       from reschedule_proposals
       where tenant_id = $1 and conversation_id = $2 and status = 'PENDING'
       order by created_at desc
       limit 1`,
      [tenantId, conversationId],
    );
    return (rows[0] as RescheduleProposal | undefined) ?? null;
  }

  async markStatus(
    tenantId: string,
    id: string,
    status: RescheduleProposal['status'],
  ): Promise<void> {
    await this.db.query(
      `update reschedule_proposals set status = $3 where tenant_id = $1 and id = $2`,
      [tenantId, id, status],
    );
  }

  async updateSlots(
    tenantId: string,
    id: string,
    slots: ProposalSlot[],
    expiresAt: Date,
  ): Promise<void> {
    await this.db.query(
      `update reschedule_proposals set slots = $3, expires_at = $4
       where tenant_id = $1 and id = $2`,
      [tenantId, id, JSON.stringify(slots), expiresAt],
    );
  }
}
