import { getTestPool, seedClinic } from './helpers/db';

describe('scheduling catalog schema', () => {
  it('creates catalog, professional and service tables', async () => {
    const pool = getTestPool();
    const { rows } = await pool.query(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = rows.map((row: { table_name: string }) => row.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'locations',
        'resources',
        'professionals',
        'professional_working_hours',
        'professional_time_off',
        'clinic_holidays',
        'services',
        'service_variants',
        'professional_services',
        'service_professional_requirements',
      ]),
    );
  });

  it('rejects working hours whose start is not before end', async () => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    const location = await pool.query(
      `insert into locations (tenant_id, name) values ($1, 'Unidade') returning id`,
      [tenantId],
    );
    const professional = await pool.query(
      `insert into professionals (tenant_id, location_id, name)
       values ($1, $2, 'Dr. Teste') returning id`,
      [tenantId, location.rows[0].id],
    );
    await expect(
      pool.query(
        `insert into professional_working_hours
           (tenant_id, professional_id, location_id, weekday, start_time, end_time)
         values ($1, $2, $3, 1, '18:00', '09:00')`,
        [tenantId, professional.rows[0].id, location.rows[0].id],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('rejects a service variant whose max quantity is below min', async () => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    const service = await pool.query(
      `insert into services (tenant_id, name, duration_minutes, price)
       values ($1, 'Extração', 60, 350) returning id`,
      [tenantId],
    );
    await expect(
      pool.query(
        `insert into service_variants
           (tenant_id, service_id, min_quantity, max_quantity, price, duration_minutes)
         values ($1, $2, 3, 2, 900, 90)`,
        [tenantId, service.rows[0].id],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('allows one habilitation per professional and service', async () => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    const location = await pool.query(
      `insert into locations (tenant_id, name) values ($1, 'Unidade') returning id`,
      [tenantId],
    );
    const professional = await pool.query(
      `insert into professionals (tenant_id, location_id, name)
       values ($1, $2, 'Dr. Teste') returning id`,
      [tenantId, location.rows[0].id],
    );
    const service = await pool.query(
      `insert into services (tenant_id, name, duration_minutes, price)
       values ($1, 'Limpeza', 40, 240) returning id`,
      [tenantId],
    );
    const insert = () =>
      pool.query(
        `insert into professional_services (tenant_id, professional_id, service_id)
         values ($1, $2, $3)`,
        [tenantId, professional.rows[0].id, service.rows[0].id],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });
});
