import request from 'supertest';
import { getTestPool, seedClinic } from './helpers/db';
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

const openTicket = async (
  pool: ReturnType<typeof getTestPool>,
  ids: { tenantId: string; conversationId?: string; contactId?: string },
  reason: string,
) =>
  pool.query(
    `insert into human_tickets
       (tenant_id, conversation_id, patient_contact_id, reason, summary, question, sla_due_at)
     values ($1, $2, $3, $4, 'ticket aberto', '?', now() + interval '15 minutes')`,
    [ids.tenantId, ids.conversationId, ids.contactId, reason],
  );

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

describe('human-active conversations', () => {
  it('reclassifies an open ticket to CLINICAL without replying', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool, { withConversation: true });
    await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
      ids.contactId,
    ]);
    await openTicket(pool, ids, 'UNKNOWN');
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(10, 'Estou com dor de dente'));

    expect(fakeChannel.sent).toHaveLength(0);

    const tickets = await pool.query(
      `select reason, summary from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(tickets.rows).toEqual([
      { reason: 'CLINICAL', summary: 'Relato clínico durante conversa humana' },
    ]);

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
    const pool = getTestPool();
    const ids = await seedClinic(pool, { withConversation: true });
    await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
      ids.contactId,
    ]);
    await openTicket(pool, ids, 'CLINICAL');
    const { app } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(11, 'Estou com dor de dente'));

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

  it('reclassifies an open ticket to EMERGENCY and still sends the protocol', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool, { withConversation: true });
    await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
      ids.contactId,
    ]);
    await openTicket(pool, ids, 'UNKNOWN');
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, ids.channelExternalId, updateText(12, 'Não consigo respirar'));

    expect(fakeChannel.sent.at(-1)?.text).toContain('SAMU');

    const tickets = await pool.query(
      `select reason from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(tickets.rows).toEqual([{ reason: 'EMERGENCY' }]);

    await app.close();
  });
});
