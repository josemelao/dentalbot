import { Queryable } from '../pool';

export interface AppendAuditInput {
  tenantId: string;
  actorType: 'patient' | 'bot' | 'human' | 'system';
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  correlationId?: string | null;
}

export class AuditRepository {
  constructor(private readonly db: Queryable) {}

  async append(input: AppendAuditInput): Promise<void> {
    await this.db.query(
      `insert into audit_logs
         (tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata, correlation_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.tenantId,
        input.actorType,
        input.actorId ?? null,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.metadata ?? {},
        input.correlationId ?? null,
      ],
    );
  }
}
