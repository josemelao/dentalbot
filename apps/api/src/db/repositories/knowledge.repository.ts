import { Queryable } from '../pool';
import { KnowledgeEntry } from './rows';

export class KnowledgeRepository {
  constructor(private readonly db: Queryable) {}

  async listApproved(tenantId: string, at: Date): Promise<KnowledgeEntry[]> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", category, question, answer, keywords, status,
              valid_from as "validFrom", valid_to as "validTo"
       from knowledge_entries
       where tenant_id = $1
         and status = 'approved'
         and valid_from <= $2
         and (valid_to is null or valid_to > $2)
       order by valid_from desc`,
      [tenantId, at],
    );
    return rows as KnowledgeEntry[];
  }
}
