import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '../config/env';
import { NoopOwnerNotifier } from '../channels/owner-notifier';
import { FakeChannelAdapter } from '../channels/fake/fake-channel.adapter';
import { TelegramAdapter } from '../channels/telegram/telegram.adapter';
import { createPool } from '../db/pool';
import { AuditRepository } from '../db/repositories/audit.repository';
import { ChannelsRepository } from '../db/repositories/channels.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { TicketsRepository } from '../db/repositories/tickets.repository';
import { EscalationService } from '../pipeline/escalation.service';

const USAGE =
  'Usage: npm run ticket -- <accept|resolve> <externalUserId> [userId]\n' +
  '  accept  — a human takes over; the bot goes quiet for this conversation\n' +
  '  resolve — closes the ticket; the bot resumes';

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  if (env.nodeEnv === 'production') {
    throw new Error(
      'ticket CLI has no authentication and refuses to run in production; use the inbox instead',
    );
  }

  const [action, externalUserId, userId] = process.argv.slice(2);
  if ((action !== 'accept' && action !== 'resolve') || !externalUserId) {
    throw new Error(USAGE);
  }

  const pool = createPool(env.databaseUrl);
  try {
    const contacts = await pool.query<{ id: string; tenantId: string }>(
      `select id, tenant_id as "tenantId" from patient_contacts
       where external_user_id = $1 order by created_at desc limit 1`,
      [externalUserId],
    );
    const contact = contacts.rows[0];
    if (!contact) {
      throw new Error(`No contact with external_user_id=${externalUserId}`);
    }

    const tickets = new TicketsRepository(pool);
    const ticket = await tickets.findOpenByContact(contact.tenantId, contact.id);
    if (!ticket) {
      throw new Error('No open ticket for this contact');
    }

    const escalation = new EscalationService({
      tickets,
      channels: new ChannelsRepository(pool),
      conversations: new ConversationsRepository(pool),
      patients: new PatientsRepository(pool),
      messages: new MessagesRepository(pool),
      audit: new AuditRepository(pool),
      notifier: new NoopOwnerNotifier(),
      ownerChannel: 'telegram',
      channel: env.channelTransport === 'fake' ? new FakeChannelAdapter() : new TelegramAdapter(env),
      slaMinutes: env.slaMinutes,
    });

    const result =
      action === 'accept'
        ? await escalation.accept({ tenantId: contact.tenantId, ticket, userId: userId ?? null })
        : await escalation.resolve({ tenantId: contact.tenantId, ticket });

    console.log(`${action} ok`, {
      ticketId: result.id,
      status: result.status,
      reason: result.reason,
      acceptedAt: result.acceptedAt,
    });
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
