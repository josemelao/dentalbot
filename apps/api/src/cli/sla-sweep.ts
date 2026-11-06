import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '../config/env';
import { FakeChannelAdapter } from '../channels/fake/fake-channel.adapter';
import { TelegramAdapter } from '../channels/telegram/telegram.adapter';
import { createPool } from '../db/pool';
import { AuditRepository } from '../db/repositories/audit.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { TicketsRepository } from '../db/repositories/tickets.repository';
import { SlaService } from '../pipeline/sla.service';

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);

  try {
    const channel =
      env.channelTransport === 'fake' ? new FakeChannelAdapter() : new TelegramAdapter(env);

    const service = new SlaService({
      tickets: new TicketsRepository(pool),
      messages: new MessagesRepository(pool),
      conversations: new ConversationsRepository(pool),
      patients: new PatientsRepository(pool),
      audit: new AuditRepository(pool),
      channel,
      now: () => new Date(),
    });

    const clinics = await pool.query<{ id: string; name: string }>(
      `select id, name from clinics where status = 'active' order by name`,
    );

    let delivered = 0;
    for (const clinic of clinics.rows) {
      const result = await service.sweepTenant(clinic.id);
      delivered += result.delivered;
      if (result.overdue > 0) {
        console.log('SLA sweep', clinic.name, result);
      }
    }

    console.log(
      `SLA sweep done: ${clinics.rows.length} clinic(s), ${delivered} fallback message(s) sent`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
