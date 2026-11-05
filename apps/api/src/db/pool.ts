import { Pool } from 'pg';

export type Queryable = Pick<Pool, 'query'>;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}
