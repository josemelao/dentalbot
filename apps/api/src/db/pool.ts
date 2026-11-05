import { Pool } from 'pg';

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}
