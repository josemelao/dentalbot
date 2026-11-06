import { FakeChannelAdapter } from '../src/channels/fake/fake-channel.adapter';
import { AuditRepository } from '../src/db/repositories/audit.repository';
import { ConversationsRepository } from '../src/db/repositories/conversations.repository';
import { MessagesRepository } from '../src/db/repositories/messages.repository';
import { PatientsRepository } from '../src/db/repositories/patients.repository';
import { TicketsRepository } from '../src/db/repositories/tickets.repository';
import { SLA_FALLBACK_TEXT, SlaService } from '../src/pipeline/sla.service';
import { getTestPool, seedClinic } from './helpers/db';

const build = (pool: any, now = new Date()) => {
  const channel = new FakeChannelAdapter();
  const service = new SlaService({
    tickets: new TicketsRepository(pool),
    messages: new MessagesRepository(pool),
    conversations: new ConversationsRepository(pool),
    patients: new PatientsRepository(pool),
    audit: new AuditRepository(pool),
    channel,
    now: () => now,
  });
  return { service, channel };
};

const seedOverdueTicket = async (pool: any, accepted: boolean) => {
  const ids = await seedClinic(pool, { withConversation: true });
  await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
    ids.contactId,
  ]);
  await pool.query(
    `insert into human_tickets
       (tenant_id, conversation_id, patient_contact_id, reason, summary, question, sla_due_at, accepted_at)
     values ($1, $2, $3, 'UNKNOWN', 'duvida', '?', now() - interval '5 minutes',
             case when $4 then now() else null end)`,
    [ids.tenantId, ids.conversationId, ids.contactId, accepted],
  );
  return ids;
};

describe('SlaService', () => {
  it('sends a fallback to the patient when nobody accepted in time', async () => {
    const pool = getTestPool();
    const ids = await seedOverdueTicket(pool, false);
    const { service, channel } = build(pool);

    const result = await service.sweepTenant(ids.tenantId);

    expect(result).toEqual({ tenantId: ids.tenantId, overdue: 1, delivered: 1, failed: 0 });
    expect(channel.sent.at(-1)).toMatchObject({
      externalUserId: '42',
      text: SLA_FALLBACK_TEXT,
    });

    const events = await pool.query(
      `select event from ticket_events where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(events.rows).toEqual([{ event: 'fallback' }]);

    const ticket = await pool.query(
      `select status from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(ticket.rows).toEqual([{ status: 'open' }]);
  });

  it('never chases the same ticket twice', async () => {
    const pool = getTestPool();
    const ids = await seedOverdueTicket(pool, false);
    const { service, channel } = build(pool);

    await service.sweepTenant(ids.tenantId);
    const second = await service.sweepTenant(ids.tenantId);

    expect(second.overdue).toBe(0);
    expect(channel.sent).toHaveLength(1);
  });

  it('leaves accepted tickets alone', async () => {
    const pool = getTestPool();
    const ids = await seedOverdueTicket(pool, true);
    const { service, channel } = build(pool);

    const result = await service.sweepTenant(ids.tenantId);

    expect(result.overdue).toBe(0);
    expect(channel.sent).toHaveLength(0);
  });
});
