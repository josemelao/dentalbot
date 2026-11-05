import { config as loadDotenv } from 'dotenv';
import { FakeCalendarAdapter } from '../calendar/fake-calendar.adapter';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';
import { AppointmentsRepository } from '../db/repositories/appointments.repository';
import { LocksRepository } from '../db/repositories/locks.repository';
import { OperationsRepository } from '../db/repositories/operations.repository';
import { ReconciliationService } from '../scheduling/reconciliation.service';

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);

  try {
    const reconciliation = new ReconciliationService({
      operations: new OperationsRepository(pool),
      appointments: new AppointmentsRepository(pool),
      locks: new LocksRepository(pool),
      // The Google adapter is wired in Phase 2 Task 11. The CLI stays usable
      // with the deterministic adapter for local/dev reconciliation.
      calendar: new FakeCalendarAdapter(),
    });

    const releasedLocks = await reconciliation.releaseExpiredLocks(new Date());
    const { rows } = await pool.query<{ tenantId: string }>(
      `select distinct tenant_id as "tenantId"
       from appointment_operations where status = 'UNKNOWN'`,
    );

    let confirmed = 0;
    let failed = 0;
    for (const row of rows) {
      const summary = await reconciliation.reconcileUnknown(row.tenantId);
      confirmed += summary.confirmed;
      failed += summary.failed;
    }

    console.log(
      `reconcile: releasedLocks=${releasedLocks} confirmed=${confirmed} failed=${failed}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
