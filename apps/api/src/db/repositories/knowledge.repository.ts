import { Queryable } from '../pool';
import { KnowledgeEntry } from './rows';

export class KnowledgeRepository {
  constructor(private readonly db: Queryable) {}

  async listAll(tenantId: string): Promise<KnowledgeEntry[]> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", category, question, answer, keywords, status,
              valid_from as "validFrom", valid_to as "validTo"
       from knowledge_entries
       where tenant_id = $1
       order by status, question`,
      [tenantId],
    );
    return rows as KnowledgeEntry[];
  }

  async create(input: {
    tenantId: string;
    category: string;
    question: string;
    answer: string;
    keywords: string[];
    status: 'draft' | 'approved';
  }): Promise<KnowledgeEntry> {
    const { rows } = await this.db.query(
      `insert into knowledge_entries
         (tenant_id, category, question, answer, keywords, status)
       values ($1, $2, $3, $4, $5, $6)
       returning id, tenant_id as "tenantId", category, question, answer, keywords, status,
                 valid_from as "validFrom", valid_to as "validTo"`,
      [
        input.tenantId,
        input.category,
        input.question,
        input.answer,
        input.keywords,
        input.status,
      ],
    );
    return rows[0] as KnowledgeEntry;
  }

  async update(
    tenantId: string,
    id: string,
    input: {
      answer: string;
      keywords: string[];
      status: 'draft' | 'approved' | 'retired';
    },
  ): Promise<void> {
    await this.db.query(
      `update knowledge_entries
       set answer = $3, keywords = $4, status = $5, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, id, input.answer, input.keywords, input.status],
    );
  }

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
