import { Queryable } from '../pool';

export interface MessageTemplateRow {
  key: string;
  variants: string[];
  status: string;
}

export class MessageTemplatesRepository {
  constructor(private readonly db: Queryable) {}

  async listActive(tenantId: string): Promise<MessageTemplateRow[]> {
    const { rows } = await this.db.query(
      `select key, variants, status
       from message_templates
       where tenant_id = $1 and status = 'active'
       order by key`,
      [tenantId],
    );
    return rows as MessageTemplateRow[];
  }

  async upsert(tenantId: string, key: string, variants: string[]): Promise<void> {
    await this.db.query(
      `insert into message_templates (tenant_id, key, variants, status)
       values ($1, $2, $3, 'active')
       on conflict (tenant_id, key)
       do update set variants = excluded.variants, status = 'active', updated_at = now()`,
      [tenantId, key, variants],
    );
  }
}
