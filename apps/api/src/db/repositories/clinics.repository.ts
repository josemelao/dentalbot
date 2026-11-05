import { Queryable } from '../pool';
import { Clinic } from './rows';

export class ClinicsRepository {
  constructor(private readonly db: Queryable) {}

  async findById(tenantId: string): Promise<Clinic | null> {
    const { rows } = await this.db.query(
      `select id, name, timezone, locale, status from clinics where id = $1`,
      [tenantId],
    );
    return (rows[0] as Clinic | undefined) ?? null;
  }
}
