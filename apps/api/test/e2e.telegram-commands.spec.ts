import request from 'supertest';
import { NoopOwnerNotifier } from '../src/channels/owner-notifier';
import { AuditRepository } from '../src/db/repositories/audit.repository';
import { ChannelsRepository } from '../src/db/repositories/channels.repository';
import { ConversationsRepository } from '../src/db/repositories/conversations.repository';
import { TicketsRepository } from '../src/db/repositories/tickets.repository';
import { EscalationService } from '../src/pipeline/escalation.service';
import { getTestPool, seedClinic, seedKnowledge } from './helpers/db';
import { buildTestApp } from './helpers/app';

const updateText = (updateId: number, text: string) => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    date: 1730000000,
    chat: { id: 42, type: 'private' },
    from: { id: 42, first_name: 'Maria' },
    text,
  },
});

const post = (app: unknown, channelId: string, body: object) =>
  request((app as { getHttpServer: () => unknown }).getHttpServer() as never)
    .post(`/webhooks/telegram/${channelId}`)
    .set('x-telegram-bot-api-secret-token', 'test-secret')
    .send(body);

interface Seeded {
  tenantId: string;
  conversationId?: string;
  contactId?: string;
}

const openTicket = async (
  pool: ReturnType<typeof getTestPool>,
  ids: Seeded,
  reason: string,
  accepted = false,
) =>
  pool.query(
    `insert into human_tickets
       (tenant_id, conversation_id, patient_contact_id, reason, summary, question, sla_due_at, accepted_at)
     values ($1, $2, $3, $4, 'ticket aberto', '?', now() + interval '15 minutes',
             case when $5 then now() else null end)`,
    [ids.tenantId, ids.conversationId, ids.contactId, reason, accepted],
  );

const withConversation = async () => {
  const pool = getTestPool();
  const ids = await seedClinic(pool, { withConversation: true });
  await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
    ids.contactId,
  ]);
  return { pool, ids };
};

describe('telegram commands', () => {
  it('treats /start as a greeting and opens no ticket', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(1, '/start'));

    expect(fakeChannel.sent.at(-1)?.text).toContain('secretária virtual');

    const tickets = await pool.query(
      `select count(*)::int as n from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(tickets.rows[0].n).toBe(0);

    const conversations = await pool.query(
      `select state from conversations where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(conversations.rows).toEqual([{ state: 'ACTIVE' }]);

    await app.close();
  });

  it('strips the bot mention so /start@Bot still matches', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(2, '/start@DentalAssistAppBot'));

    expect(fakeChannel.sent.at(-1)?.text).toContain('secretária virtual');
    const tickets = await pool.query(
      `select count(*)::int as n from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(tickets.rows[0].n).toBe(0);

    await app.close();
  });
});

describe('open ticket is not a takeover', () => {
  it('keeps answering administrative questions while nobody accepted', async () => {
    const { pool, ids } = await withConversation();
    await seedKnowledge(pool, ids.tenantId, [
      {
        category: 'logistica',
        question: 'Qual o horário de funcionamento?',
        answer: 'Atendemos de segunda a sexta, das 9h às 18h.',
        keywords: ['horario'],
        status: 'approved',
      },
    ]);
    await openTicket(pool, ids, 'UNKNOWN');
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(10, 'Qual o horário de vocês?'));

    expect(fakeChannel.sent.at(-1)?.text).toBe('Atendemos de segunda a sexta, das 9h às 18h.');
    await app.close();
  });

  it('lets the patient cancel even with an open ticket', async () => {
    const { pool, ids } = await withConversation();
    await openTicket(pool, ids, 'UNKNOWN');
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(11, 'quero cancelar'));

    // No appointment exists, so the flow escalates — but the message was handled.
    expect(fakeChannel.sent.at(-1)?.text).toMatch(/Não encontrei um agendamento futuro/);
    await app.close();
  });

  it('reclassifies an unaccepted ticket to CLINICAL and still sends the holding reply', async () => {
    const { pool, ids } = await withConversation();
    await openTicket(pool, ids, 'UNKNOWN');
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(12, 'Estou com dor de dente'));

    expect(fakeChannel.sent.at(-1)?.text).toContain('Recebi sua mensagem');

    const tickets = await pool.query(
      `select reason, summary from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(tickets.rows).toEqual([{ reason: 'CLINICAL', summary: 'Dúvida clínica' }]);

    const events = await pool.query(
      `select event, metadata from ticket_events where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].event).toBe('reclassified');
    expect(events.rows[0].metadata).toEqual({ from: 'UNKNOWN', to: 'CLINICAL' });

    await app.close();
  });

  it('never downgrades a stronger ticket', async () => {
    const { pool, ids } = await withConversation();
    await openTicket(pool, ids, 'CLINICAL');
    const { app } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(13, 'Estou com dor de dente'));

    const tickets = await pool.query(
      `select reason from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(tickets.rows).toEqual([{ reason: 'CLINICAL' }]);

    const events = await pool.query(
      `select count(*)::int as n from ticket_events where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(events.rows[0].n).toBe(0);

    await app.close();
  });

  it('heals a stale HUMAN_ACTIVE conversation without acceptance', async () => {
    const { pool, ids } = await withConversation();
    await openTicket(pool, ids, 'UNKNOWN');
    await pool.query(`update conversations set state = 'HUMAN_ACTIVE' where id = $1`, [
      ids.conversationId,
    ]);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(14, '/start'));

    expect(fakeChannel.sent.at(-1)?.text).toContain('secretária virtual');

    const conversations = await pool.query(`select state from conversations where id = $1`, [
      ids.conversationId,
    ]);
    expect(conversations.rows).toEqual([{ state: 'REQUIRES_HUMAN' }]);

    await app.close();
  });
});

describe('accepted ticket hands the conversation to the human', () => {
  it('stays silent but still records a clinical signal', async () => {
    const { pool, ids } = await withConversation();
    await openTicket(pool, ids, 'UNKNOWN', true);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(20, 'Estou com dor de dente'));

    expect(fakeChannel.sent).toHaveLength(0);

    const tickets = await pool.query(
      `select reason from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(tickets.rows).toEqual([{ reason: 'CLINICAL' }]);

    const conversations = await pool.query(
      `select state from conversations where id = $1`,
      [ids.conversationId],
    );
    expect(conversations.rows).toEqual([{ state: 'HUMAN_ACTIVE' }]);

    await app.close();
  });

  it('still sends the emergency protocol', async () => {
    const { pool, ids } = await withConversation();
    await openTicket(pool, ids, 'UNKNOWN', true);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(21, 'Não consigo respirar'));

    expect(fakeChannel.sent.at(-1)?.text).toContain('SAMU');

    const tickets = await pool.query(
      `select reason from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(tickets.rows).toEqual([{ reason: 'EMERGENCY' }]);

    await app.close();
  });

  it('resumes the bot after the ticket is resolved', async () => {
    const { pool, ids } = await withConversation();
    await openTicket(pool, ids, 'CLINICAL', true);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(22, 'Oi, tudo bem?'));
    expect(fakeChannel.sent).toHaveLength(0);

    const tickets = new TicketsRepository(pool);
    const ticket = await tickets.findOpenByContact(ids.tenantId, ids.contactId!);
    if (!ticket) throw new Error('setup failed');

    await new EscalationService({
      tickets,
      channels: new ChannelsRepository(pool),
      conversations: new ConversationsRepository(pool),
      audit: new AuditRepository(pool),
      notifier: new NoopOwnerNotifier(),
      slaMinutes: 15,
    }).resolve({ tenantId: ids.tenantId, ticket });

    await post(app, ids.channelExternalId, updateText(23, '/start'));
    expect(fakeChannel.sent.at(-1)?.text).toContain('secretária virtual');

    const conversations = await pool.query(
      `select state from conversations where id = $1`,
      [ids.conversationId],
    );
    expect(conversations.rows).toEqual([{ state: 'ACTIVE' }]);

    await app.close();
  });
});
