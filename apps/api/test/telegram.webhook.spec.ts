import request from 'supertest';
import { getTestPool, seedClinic } from './helpers/db';
import { buildTestApp } from './helpers/app';

const update = (updateId = 1001, messageId = 55, text = 'Qual o horário de vocês?') => ({
  update_id: updateId,
  message: {
    message_id: messageId,
    date: 1730000000,
    chat: { id: 42, type: 'private' },
    from: { id: 42, first_name: 'Maria' },
    text,
  },
});

const post = (app: unknown, channelId: string, body: object, secret = 'test-secret') =>
  request((app as { getHttpServer: () => unknown }).getHttpServer() as never)
    .post(`/webhooks/telegram/${channelId}`)
    .set('x-telegram-bot-api-secret-token', secret)
    .send(body);

describe('telegram webhook', () => {
  it('rejects a wrong secret', async () => {
    const pool = getTestPool();
    const { channelExternalId } = await seedClinic(pool);
    const { app } = await buildTestApp({ pool });
    const res = await post(app, channelExternalId, update(), 'wrong');
    expect(res.status).toBe(401);
    await app.close();
  });

  it('returns 404 for an unconfigured channel without leaking tenant data', async () => {
    const pool = getTestPool();
    await seedClinic(pool);
    const { app } = await buildTestApp({ pool });
    const res = await post(app, 'unknown-bot', update());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false });
    await app.close();
  });

  it('stores one event and one inbound message', async () => {
    const pool = getTestPool();
    const { channelExternalId, tenantId } = await seedClinic(pool);
    const { app } = await buildTestApp({ pool });
    const res = await post(app, channelExternalId, update());
    expect(res.status).toBe(200);

    const events = await pool.query(`select status from webhook_events where tenant_id = $1`, [
      tenantId,
    ]);
    expect(events.rows).toEqual([{ status: 'processed' }]);

    const messages = await pool.query(
      `select message_type, content from messages where tenant_id = $1 and direction = 'in'`,
      [tenantId],
    );
    expect(messages.rows).toEqual([{ message_type: 'text', content: 'Qual o horário de vocês?' }]);
    await app.close();
  });

  it('ignores a replayed update_id', async () => {
    const pool = getTestPool();
    const { channelExternalId, tenantId } = await seedClinic(pool);
    const { app } = await buildTestApp({ pool });

    await post(app, channelExternalId, update());
    const second = await post(app, channelExternalId, update());
    expect(second.status).toBe(200);

    const messages = await pool.query(
      `select count(*)::int as n from messages where tenant_id = $1 and direction = 'in'`,
      [tenantId],
    );
    const events = await pool.query(`select count(*)::int as n from webhook_events where tenant_id = $1`, [
      tenantId,
    ]);
    expect(messages.rows[0].n).toBe(1);
    expect(events.rows[0].n).toBe(1);
    await app.close();
  });

  it('marks an unsupported update as skipped', async () => {
    const pool = getTestPool();
    const { channelExternalId, tenantId } = await seedClinic(pool);
    const { app } = await buildTestApp({ pool });
    const res = await post(app, channelExternalId, {
      update_id: 2001,
      edited_message: { message_id: 9 },
    });
    expect(res.status).toBe(200);

    const events = await pool.query(`select status from webhook_events where tenant_id = $1`, [
      tenantId,
    ]);
    expect(events.rows).toEqual([{ status: 'skipped' }]);
    await app.close();
  });
});
