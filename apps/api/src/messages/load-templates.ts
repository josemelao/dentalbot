import { Pool } from 'pg';
import { MessageTemplatesRepository } from '../db/repositories/message-templates.repository';
import { setTemplateOverrides } from './templates';

/**
 * Loads the clinic's template overrides into memory at boot.
 *
 * The panel updates the in-memory copy on every write, so a running instance
 * never needs a restart to pick up an edited message.
 */
export async function loadTemplates(pool: Pool): Promise<number> {
  const clinics = await pool.query<{ id: string }>(
    `select id from clinics where status = 'active' order by created_at limit 1`,
  );
  const tenantId = clinics.rows[0]?.id;
  if (!tenantId) return 0;

  const rows = await new MessageTemplatesRepository(pool).listActive(tenantId);
  setTemplateOverrides(rows.map((row) => ({ key: row.key, variants: row.variants })));
  return rows.length;
}
