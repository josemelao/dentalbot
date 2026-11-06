import request from 'supertest';
import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { buildTestApp } from './helpers/app';

const update = (updateId: number, text: string) => ({
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

const linkPatient = async (pool: any, clinic: any) => {
  const {
    rows: [patient],
  } = await pool.query(
    `insert into patients (tenant_id, full_name, birth_date)
     values ($1, 'Maria Silva', '1990-05-10') returning id`,
    [clinic.tenantId],
  );
  await pool.query(
    `update patient_contacts set external_user_id = '42', patient_id = $1 where id = $2`,
    [patient.id, clinic.contactId],
  );
};

const bookThroughWebhook = async (app: unknown, channelId: string, startId: number) => {
  await post(app, channelId, update(startId, 'quero marcar limpeza'));
  await post(app, channelId, update(startId + 1, '1'));
  await post(app, channelId, update(startId + 2, 'SIM'));
};

describe('scheduling end-to-end', () => {
  it('offers slots and books through the webhook', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    await seedScheduling(pool, clinic.tenantId);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, clinic.channelExternalId, update(1, 'quero marcar limpeza'));
    expect(fakeChannel.sent.at(-1)?.text).toMatch(/1\)/);

    await post(app, clinic.channelExternalId, update(2, '1'));
    expect(fakeChannel.sent.at(-1)?.text).toMatch(/SIM/);

    await post(app, clinic.channelExternalId, update(3, 'SIM'));
    expect(fakeChannel.sent.at(-1)?.text).toMatch(/Agendado/);

    const appointments = await pool.query(
      `select status from appointments where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(appointments.rows).toEqual([{ status: 'BOOKED' }]);
    await app.close();
  });

  it('reschedules through the webhook after identity verification', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    await seedScheduling(pool, clinic.tenantId);
    await linkPatient(pool, clinic);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await bookThroughWebhook(app, clinic.channelExternalId, 10);
    const old = await pool.query(
      `select id, status from appointments where tenant_id = $1 order by created_at`,
      [clinic.tenantId],
    );
    expect(old.rows).toHaveLength(1);
    expect(old.rows[0].status).toBe('BOOKED');
    const oldId = old.rows[0].id;

    await post(app, clinic.channelExternalId, update(20, 'quero remarcar'));
    expect(fakeChannel.sent.at(-1)?.text.toLowerCase()).toMatch(
      /nome completo|data de nascimento/,
    );

    await post(app, clinic.channelExternalId, update(21, 'Maria Silva, 10/05/1990'));
    expect(fakeChannel.sent.at(-1)?.text).toMatch(/1\)/);

    await post(app, clinic.channelExternalId, update(22, '1'));
    expect(fakeChannel.sent.at(-1)?.text).toMatch(/SIM/);

    await post(app, clinic.channelExternalId, update(23, 'SIM'));
    expect(fakeChannel.sent.at(-1)?.text).toMatch(/Remarcado/);

    const rows = await pool.query(
      `select id, status from appointments where tenant_id = $1 order by created_at`,
      [clinic.tenantId],
    );
    expect(rows.rows[0]).toEqual({ id: oldId, status: 'CANCELLED' });
    expect(rows.rows[1].status).toBe('BOOKED');
    await app.close();
  });

  it('cancels only after explicit confirmation', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    await seedScheduling(pool, clinic.tenantId);
    await linkPatient(pool, clinic);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await bookThroughWebhook(app, clinic.channelExternalId, 30);

    await post(app, clinic.channelExternalId, update(40, 'quero cancelar'));
    expect(fakeChannel.sent.at(-1)?.text.toLowerCase()).toMatch(
      /nome completo|data de nascimento/,
    );

    await post(app, clinic.channelExternalId, update(41, 'Maria Silva, 10/05/1990'));
    expect(fakeChannel.sent.at(-1)?.text).toMatch(/SIM ou NÃO/);

    await post(app, clinic.channelExternalId, update(42, 'acho que não vou conseguir'));
    const still = await pool.query(
      `select status from appointments where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(still.rows).toEqual([{ status: 'BOOKED' }]);

    await post(app, clinic.channelExternalId, update(43, 'SIM'));
    expect(fakeChannel.sent.at(-1)?.text).toMatch(/Cancelamento registrado/);

    const cancelled = await pool.query(
      `select status from appointments where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(cancelled.rows).toEqual([{ status: 'CANCELLED' }]);
    await app.close();
  });

  it('lists upcoming appointments after identity verification', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    await seedScheduling(pool, clinic.tenantId);
    await linkPatient(pool, clinic);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await bookThroughWebhook(app, clinic.channelExternalId, 50);

    await post(app, clinic.channelExternalId, update(60, 'quais atendimentos tenho marcado'));
    expect(fakeChannel.sent.at(-1)?.text.toLowerCase()).toMatch(
      /nome completo|data de nascimento/,
    );

    await post(app, clinic.channelExternalId, update(61, 'Maria Silva, 10/05/1990'));
    const listing = fakeChannel.sent.at(-1)?.text ?? '';
    expect(listing).toContain('Seus próximos atendimentos');
    expect(listing).toContain('Limpeza');

    const tickets = await pool.query(
      `select count(*)::int as n from human_tickets where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(tickets.rows[0].n).toBe(0);

    await app.close();
  });

  it('says there is nothing upcoming instead of escalating', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    await seedScheduling(pool, clinic.tenantId);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, clinic.channelExternalId, update(70, 'quais atendimentos tenho marcado'));

    expect(fakeChannel.sent.at(-1)?.text).toContain('Não encontrei atendimentos futuros');

    const tickets = await pool.query(
      `select count(*)::int as n from human_tickets where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(tickets.rows[0].n).toBe(0);

    await app.close();
  });
});
