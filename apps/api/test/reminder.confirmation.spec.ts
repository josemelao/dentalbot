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

const linkPatient = async (pool: any, tenantId: string, contactId: string) => {
  const { rows } = await pool.query(
    `insert into patients (tenant_id, full_name, birth_date)
     values ($1, 'Maria Silva', '1990-05-10') returning id`,
    [tenantId],
  );
  await pool.query(`update patient_contacts set patient_id = $1 where id = $2`, [
    rows[0].id,
    contactId,
  ]);
};

const setupWithAppointment = async () => {
  const pool = getTestPool();
  const clinic = await seedClinic(pool, { withConversation: true });
  const scheduling = await seedScheduling(pool, clinic.tenantId);
  await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
    clinic.contactId,
  ]);
  await linkPatient(pool, clinic.tenantId, clinic.contactId!);

  const { rows } = await pool.query(
    `insert into appointments
       (tenant_id, patient_contact_id, service_id, location_id, start_at, end_at, status)
     values ($1, $2, $3, $4, now() + interval '24 hours',
             now() + interval '24 hours 40 minutes', 'BOOKED')
     returning id`,
    [clinic.tenantId, clinic.contactId, scheduling.cleaningServiceId, scheduling.locationId],
  );

  const { app, fakeChannel } = await buildTestApp({ pool });
  return { pool, clinic, app, fakeChannel, appointmentId: rows[0].id as string };
};

describe('reminder replies', () => {
  it('confirms the appointment when the patient answers SIM', async () => {
    const { pool, clinic, app, fakeChannel, appointmentId } = await setupWithAppointment();

    await post(app, clinic.channelExternalId, update(1, 'sim'));

    expect(fakeChannel.sent.at(-1)?.text).toContain('Presença confirmada');
    expect(fakeChannel.sent.at(-1)?.text).toContain('Limpeza');

    const row = await pool.query(
      `select confirmation_status from appointments where id = $1`,
      [appointmentId],
    );
    expect(row.rows[0].confirmation_status).toBe('CONFIRMED');

    await app.close();
  });

  it('sends "não vou poder" to the cancel flow, which asks for identity', async () => {
    const { clinic, app, fakeChannel } = await setupWithAppointment();

    await post(app, clinic.channelExternalId, update(2, 'não vou poder ir'));

    expect(fakeChannel.sent.at(-1)?.text.toLowerCase()).toMatch(
      /nome completo|data de nascimento/,
    );

    await app.close();
  });

  it('does not invent a confirmation when there is no pending appointment', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
      clinic.contactId,
    ]);
    const { app, fakeChannel } = await buildTestApp({ pool });

    await post(app, clinic.channelExternalId, update(3, 'sim'));

    expect(fakeChannel.sent.at(-1)?.text).toContain('contar um pouco mais');
    expect(fakeChannel.sent.at(-1)?.text).not.toContain('Presença confirmada');

    const tickets = await pool.query(
      `select count(*)::int as n from human_tickets where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(tickets.rows[0].n).toBe(0);

    await app.close();
  });
});
