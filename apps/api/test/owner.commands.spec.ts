import request from 'supertest';
import { getTestPool, seedClinic } from './helpers/db';
import { buildTestApp } from './helpers/app';

const OWNER_ID = 999;

const update = (updateId: number, fromId: number, text: string) => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    date: 1730000000,
    chat: { id: fromId, type: 'private' },
    from: { id: fromId, first_name: 'Chow' },
    text,
  },
});

const post = (app: unknown, channelId: string, body: object) =>
  request((app as { getHttpServer: () => unknown }).getHttpServer() as never)
    .post(`/webhooks/telegram/${channelId}`)
    .set('x-telegram-bot-api-secret-token', 'test-secret')
    .send(body);

const setup = async () => {
  const pool = getTestPool();
  const ids = await seedClinic(pool, { withConversation: true });
  await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
    ids.contactId,
  ]);
  await pool.query(
    `update clinic_user_channels set external_user_id = $1
     where tenant_id = $2 and user_id = $3`,
    [String(OWNER_ID), ids.tenantId, ids.ownerId],
  );
  await pool.query(
    `delete from clinic_user_channels where tenant_id = $1 and user_id = $2`,
    [ids.tenantId, ids.dentistId],
  );
  const { app, fakeChannel, notifier } = await buildTestApp({ pool });
  return { pool, ids, app, fakeChannel, notifier };
};

const escalate = async (app: unknown, channelId: string, updateId: number) => {
  await post(app, channelId, update(updateId, 42, 'Estou com dor de dente'));
};

describe('owner commands', () => {
  it('notifies the owner and keeps the owner out of the patient flow', async () => {
    const { pool, ids, app, fakeChannel, notifier } = await setup();

    await escalate(app, ids.channelExternalId, 1);

    expect(notifier.deliveries).toHaveLength(1);
    expect(notifier.deliveries[0].text).toContain('[TICKET #');

    await post(app, ids.channelExternalId, update(2, OWNER_ID, 'oi'));

    // The owner gets the menu, not a patient conversation.
    expect(fakeChannel.sent.at(-1)).toMatchObject({ externalUserId: String(OWNER_ID) });
    expect(fakeChannel.sent.at(-1)?.text).toContain('1) Assumir a conversa');

    const contacts = await pool.query(
      `select count(*)::int as n from patient_contacts where external_user_id = $1`,
      [String(OWNER_ID)],
    );
    expect(contacts.rows[0].n).toBe(0);
  });

  it('relays the owner answer to the patient and records it on the ticket', async () => {
    const { pool, ids, app, fakeChannel } = await setup();
    await escalate(app, ids.channelExternalId, 3);

    await post(
      app,
      ids.channelExternalId,
      update(4, OWNER_ID, '3 Pode vir amanhã às 9h para avaliação.'),
    );

    const toPatient = fakeChannel.sent.filter((message) => message.externalUserId === '42').at(-1);
    expect(toPatient?.text).toBe('Pode vir amanhã às 9h para avaliação.');
    expect(fakeChannel.sent.at(-1)?.externalUserId).toBe(String(OWNER_ID));
    expect(fakeChannel.sent.at(-1)?.text).toContain('Resposta enviada ao paciente');

    const ticket = await pool.query(
      `select status, answer from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(ticket.rows[0]).toEqual({
      status: 'answered',
      answer: 'Pode vir amanhã às 9h para avaliação.',
    });

    const events = await pool.query(
      `select event from ticket_events where tenant_id = $1 order by created_at`,
      [ids.tenantId],
    );
    expect(events.rows.map((row: { event: string }) => row.event)).toEqual([
      'created',
      'notified',
      'answered',
    ]);
  });

  it('assumes the conversation so the bot goes quiet, then resolves it', async () => {
    const { pool, ids, app, fakeChannel } = await setup();
    await escalate(app, ids.channelExternalId, 5);

    await post(app, ids.channelExternalId, update(6, OWNER_ID, '1'));
    expect(fakeChannel.sent.at(-1)?.text).toContain('Conversa assumida');

    const sentBefore = fakeChannel.sent.length;
    await post(app, ids.channelExternalId, update(7, 42, 'Oi, tudo bem?'));
    expect(fakeChannel.sent).toHaveLength(sentBefore);
    const accepted = await pool.query(
      `select accepted_at from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(accepted.rows[0].accepted_at).not.toBeNull();

    await post(app, ids.channelExternalId, update(8, OWNER_ID, '2'));
    expect(fakeChannel.sent.at(-1)?.text).toContain('Ticket encerrado');

    await post(app, ids.channelExternalId, update(9, 42, '/start'));
    expect(fakeChannel.sent.at(-1)?.externalUserId).toBe('42');
    expect(fakeChannel.sent.at(-1)?.text).toContain('secretária virtual');

    const conversation = await pool.query(
      `select state from conversations where id = $1`,
      [ids.conversationId],
    );
    expect(conversation.rows).toEqual([{ state: 'ACTIVE' }]);
  });

  it('tells the owner when there is no open ticket', async () => {
    const { ids, app, fakeChannel } = await setup();

    await post(app, ids.channelExternalId, update(10, OWNER_ID, '1'));

    expect(fakeChannel.sent.at(-1)?.text).toContain('Nenhum ticket aberto');
  });
});
