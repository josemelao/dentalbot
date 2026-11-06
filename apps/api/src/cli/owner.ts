import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '../config/env';
import { FakeChannelAdapter } from '../channels/fake/fake-channel.adapter';
import { ChannelOwnerNotifier } from '../channels/owner-notifier';
import { TelegramAdapter } from '../channels/telegram/telegram.adapter';
import { createPool } from '../db/pool';
import { AuditRepository } from '../db/repositories/audit.repository';
import { ChannelsRepository } from '../db/repositories/channels.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { TicketsRepository } from '../db/repositories/tickets.repository';
import { EscalationService } from '../pipeline/escalation.service';

const USAGE =
  'Usage: npm run owner -- <link|unlink> <externalUserId> [ownerName]\n' +
  '  link   — this Telegram id becomes staff: it receives ticket cards and can reply 1/2/3\n' +
  '  unlink — removes the link, so the id goes back to being treated as a patient';

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  if (env.nodeEnv === 'production') {
    throw new Error('owner CLI has no authentication and refuses to run in production');
  }

  const [action, externalUserId, ownerName] = process.argv.slice(2);
  if ((action !== 'link' && action !== 'unlink') || !externalUserId) {
    throw new Error(USAGE);
  }

  const pool = createPool(env.databaseUrl);
  try {
    const users = await pool.query<{ id: string; tenantId: string; name: string }>(
      `select id, tenant_id as "tenantId", name from clinic_users
       where status = 'active' and role in ('owner', 'dentist')
         and ($1::text is null or name ilike $1)
       order by created_at
       limit 1`,
      [ownerName ?? null],
    );
    const user = users.rows[0];
    if (!user) {
      throw new Error('No matching clinic user. Run npm run seed first.');
    }

    if (action === 'unlink') {
      await pool.query(
        `delete from clinic_user_channels
         where tenant_id = $1 and user_id = $2 and channel = 'telegram' and external_user_id = $3`,
        [user.tenantId, user.id, externalUserId],
      );
      console.log(`unlinked ${externalUserId} from ${user.name}`);
      return;
    }

    await new ChannelsRepository(pool).linkOwner(
      user.tenantId,
      user.id,
      'telegram',
      externalUserId,
    );
    console.log(
      `linked telegram ${externalUserId} to ${user.name}. ` +
        'This id now receives ticket cards and its messages are treated as staff commands. ' +
        'Use `npm run owner -- unlink ' +
        externalUserId +
        '` to undo.',
    );

    const tickets = new TicketsRepository(pool);
    const openTicket = await tickets.findLatestOpen(user.tenantId);
    if (!openTicket) {
      console.log('No open ticket to send right now.');
      return;
    }

    const channel =
      env.channelTransport === 'fake' ? new FakeChannelAdapter() : new TelegramAdapter(env);
    const { deliveredTo } = await new EscalationService({
      tickets,
      channels: new ChannelsRepository(pool),
      conversations: new ConversationsRepository(pool),
      patients: new PatientsRepository(pool),
      audit: new AuditRepository(pool),
      notifier: new ChannelOwnerNotifier(channel),
      ownerChannel: 'telegram',
      slaMinutes: env.slaMinutes,
    }).renotify(openTicket);

    console.log(`sent the open ticket card to ${deliveredTo.length} owner(s)`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
