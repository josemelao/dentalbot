import { getTestPool, seedClinic } from './helpers/db';

describe('support schema', () => {
  it('rejects an invalid knowledge status', async () => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    await expect(
      pool.query(
        `insert into knowledge_entries (tenant_id, category, question, answer, status)
         values ($1, 'logistica', 'Onde fica?', 'Rua X', 'published')`,
        [tenantId],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('makes audit_logs append-only', async () => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    const {
      rows: [row],
    } = await pool.query<{ id: string }>(
      `insert into audit_logs (tenant_id, actor_type, action, entity_type)
       values ($1, 'system', 'test', 'clinic') returning id`,
      [tenantId],
    );

    await expect(
      pool.query(`update audit_logs set action = 'tampered' where id = $1`, [row.id]),
    ).rejects.toThrow(/append-only/);

    await expect(pool.query(`delete from audit_logs where id = $1`, [row.id])).rejects.toThrow(
      /append-only/,
    );
  });
});
