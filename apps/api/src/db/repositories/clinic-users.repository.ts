import { Queryable } from '../pool';

export interface ClinicUserWithPassword {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  passwordHash: string | null;
  status: string;
}

export class ClinicUsersRepository {
  constructor(private readonly db: Queryable) {}

  async findByEmail(email: string): Promise<ClinicUserWithPassword | null> {
    const { rows } = await this.db.query(
      `select id, tenant_id as "tenantId", name, email,
              password_hash as "passwordHash", status
       from clinic_users
       where lower(email) = lower($1)
       limit 1`,
      [email],
    );
    return (rows[0] as ClinicUserWithPassword | undefined) ?? null;
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.query(
      `update clinic_users set password_hash = $2, updated_at = now() where id = $1`,
      [userId, passwordHash],
    );
  }
}
