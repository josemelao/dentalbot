import { getTestPool } from './helpers/db';

describe('core schema', () => {
  it('creates tenant tables', async () => {
    const pool = getTestPool();
    const { rows } = await pool.query(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = rows.map((r: { table_name: string }) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['schema_migrations', 'clinics', 'clinic_channels', 'clinic_users']),
    );
  });

  it('rejects a duplicate channel external id', async () => {
    const pool = getTestPool();
    const {
      rows: [clinic],
    } = await pool.query(`insert into clinics (name) values ('C1') returning id`);
    const insert = () =>
      pool.query(
        `insert into clinic_channels (tenant_id, channel, provider, external_channel_id)
         values ($1, 'telegram', 'telegram', 'bot-1')`,
        [clinic.id],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });
});
