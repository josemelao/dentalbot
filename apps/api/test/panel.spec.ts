import request from 'supertest';
import { buildTestApp } from './helpers/app';
import { ClinicUsersRepository } from '../src/db/repositories/clinic-users.repository';
import { PanelAuthService } from '../src/panel/panel-auth.service';
import { pickMessage } from '../src/messages/templates';
import { getTestPool, seedClinic, seedKnowledge, seedScheduling } from './helpers/db';
import { buildBookingService, bookingInput } from './helpers/booking';

const get = (app: unknown, path: string) =>
  request((app as { getHttpServer: () => unknown }).getHttpServer() as never).get(path);

describe('panel', () => {
  it('shows the agenda and open tickets with a valid token', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const scheduling = await seedScheduling(pool, clinic.tenantId);

    await pool.query(
      `insert into appointments
         (tenant_id, patient_contact_id, service_id, location_id, start_at, end_at, status)
       values ($1, $2, $3, $4, '2026-11-09T13:00:00Z', '2026-11-09T13:40:00Z', 'BOOKED')`,
      [clinic.tenantId, clinic.contactId, scheduling.cleaningServiceId, scheduling.locationId],
    );
    await pool.query(
      `insert into human_tickets
         (tenant_id, conversation_id, patient_contact_id, reason, summary, question, sla_due_at)
       values ($1, $2, $3, 'CLINICAL', 'dor', 'Estou com dor', now() + interval '10 minutes')`,
      [clinic.tenantId, clinic.conversationId, clinic.contactId],
    );

    const { app } = await buildTestApp({ pool });
    const response = await get(app, '/painel?token=test-panel&date=2026-11-09');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('Limpeza');
    expect(response.text).toContain('Maria');
    expect(response.text).toContain('Tickets abertos');
    expect(response.text).toContain('Estou com dor');
    expect(response.text).toContain('propor remarcação');
    expect(response.text).toContain('pedir confirmação');

    await app.close();
  });

  it('rejects a wrong token', async () => {
    const { app } = await buildTestApp({ pool: getTestPool() });
    const response = await get(app, '/painel?token=wrong');
    expect(response.status).toBe(401);
    await app.close();
  });

  it('rejects a missing token', async () => {
    const { app } = await buildTestApp({ pool: getTestPool() });
    const response = await get(app, '/painel');
    expect(response.status).toBe(401);
    await app.close();
  });

  it('edits an approved FAQ answer', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    await seedKnowledge(pool, clinic.tenantId, [
      {
        category: 'logistica',
        question: 'Horário?',
        answer: 'Antigo',
        keywords: ['horario'],
        status: 'approved',
      },
    ]);
    const { rows } = await pool.query(`select id from knowledge_entries where tenant_id = $1`, [
      clinic.tenantId,
    ]);

    const { app } = await buildTestApp({ pool });
    const response = await request((app as any).getHttpServer())
      .post(`/painel/faq/${rows[0].id}`)
      .type('form')
      .send({
        token: 'test-panel',
        answer: 'Atendemos das 8h às 18h.',
        keywords: 'horario, funcionamento',
        status: 'approved',
      });

    expect(response.status).toBe(303);

    const updated = await pool.query(
      `select answer, keywords, status from knowledge_entries where id = $1`,
      [rows[0].id],
    );
    expect(updated.rows[0]).toEqual({
      answer: 'Atendemos das 8h às 18h.',
      keywords: ['horario', 'funcionamento'],
      status: 'approved',
    });

    await app.close();
  });

  it('creates a new FAQ entry as draft', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const { app } = await buildTestApp({ pool });

    const response = await request((app as any).getHttpServer())
      .post('/painel/faq')
      .type('form')
      .send({
        token: 'test-panel',
        category: 'preco',
        question: 'Quanto custa a limpeza?',
        answer: 'R$ 250.',
        keywords: 'preco, limpeza',
        status: 'draft',
      });

    expect(response.status).toBe(303);

    const created = await pool.query(
      `select question, status from knowledge_entries where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(created.rows[0]).toEqual({
      question: 'Quanto custa a limpeza?',
      status: 'draft',
    });

    await app.close();
  });

  it('updates a service price and duration', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const scheduling = await seedScheduling(pool, clinic.tenantId);
    const { app } = await buildTestApp({ pool });

    const response = await request((app as any).getHttpServer())
      .post(`/painel/servicos/${scheduling.cleaningServiceId}`)
      .type('form')
      .send({
        token: 'test-panel',
        durationMinutes: '45',
        price: '300',
        priceDisclosureAllowed: 'on',
        status: 'active',
      });

    expect(response.status).toBe(303);

    const updated = await pool.query(
      `select duration_minutes, price, price_disclosure_allowed
       from services where id = $1`,
      [scheduling.cleaningServiceId],
    );
    expect(updated.rows[0]).toEqual({
      duration_minutes: 45,
      price: '300.00',
      price_disclosure_allowed: true,
    });

    await app.close();
  });

  it('logs in with a password and uses the session cookie', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const users = new ClinicUsersRepository(pool);
    const auth = new PanelAuthService({ users, secret: null, now: () => new Date() });
    await users.setPasswordHash(clinic.ownerId, auth.hashPassword('senha-forte-1'));

    const { app } = await buildTestApp({ pool });
    const server = (app as any).getHttpServer();

    const login = await request(server)
      .post('/painel/login')
      .type('form')
      .send({ email: `chow-${clinic.suffix}@example.com`, password: 'senha-forte-1' });

    expect(login.status).toBe(303);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeDefined();

    const page = await request(server).get('/painel').set('Cookie', cookie as unknown as string[]);
    expect(page.status).toBe(200);

    await app.close();
  });

  it('rejects a wrong password', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const users = new ClinicUsersRepository(pool);
    const auth = new PanelAuthService({ users, secret: null, now: () => new Date() });
    await users.setPasswordHash(clinic.ownerId, auth.hashPassword('senha-forte-1'));

    const { app } = await buildTestApp({ pool });
    const login = await request((app as any).getHttpServer())
      .post('/painel/login')
      .type('form')
      .send({ email: `chow-${clinic.suffix}@example.com`, password: 'errada' });

    expect(login.status).toBe(303);
    expect(login.headers.location).toContain('error=1');

    await app.close();
  });

  it('rejects a config write with a wrong token', async () => {
    const pool = getTestPool();
    const { app } = await buildTestApp({ pool });

    const response = await request((app as any).getHttpServer())
      .post('/painel/faq')
      .type('form')
      .send({ token: 'wrong', question: 'x', answer: 'y' });

    expect(response.status).toBe(401);
    await app.close();
  });

  it('sends the confirmation reminder on demand, once', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const scheduling = await seedScheduling(pool, clinic.tenantId);
    const { rows } = await pool.query(
      `insert into appointments
         (tenant_id, patient_contact_id, service_id, location_id, start_at, end_at, status)
       values ($1, $2, $3, $4, now() + interval '3 days',
               now() + interval '3 days 40 minutes', 'BOOKED')
       returning id`,
      [clinic.tenantId, clinic.contactId, scheduling.cleaningServiceId, scheduling.locationId],
    );

    const { app, fakeChannel } = await buildTestApp({ pool });
    const server = (app as any).getHttpServer();

    await request(server)
      .post(`/painel/agendamentos/${rows[0].id}/confirmar`)
      .type('form')
      .send({ token: 'test-panel' });

    expect(fakeChannel.sent.at(-1)?.text).toContain('Lembrete: Limpeza');

    await request(server)
      .post(`/painel/agendamentos/${rows[0].id}/confirmar`)
      .type('form')
      .send({ token: 'test-panel' });

    const reminders = await pool.query(
      `select count(*)::int as n from appointment_reminders where appointment_id = $1`,
      [rows[0].id],
    );
    expect(reminders.rows[0].n).toBe(1);

    await app.close();
  });

  it('shows the conversation history and clears the unread badge', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const { rows } = await pool.query(
      `insert into human_tickets
         (tenant_id, conversation_id, patient_contact_id, reason, summary, question, sla_due_at)
       values ($1, $2, $3, 'CLINICAL', 'dor', 'Estou com dor', now() + interval '10 minutes')
       returning id`,
      [clinic.tenantId, clinic.conversationId, clinic.contactId],
    );

    await pool.query(
      `insert into messages
         (tenant_id, conversation_id, channel, direction, external_message_id, message_type, content, media, delivery_status)
       values
         ($1, $2, 'telegram', 'in', 'm1', 'text', 'Estou com dor', null, 'received'),
         ($1, $2, 'telegram', 'out', null, 'text', 'Recebi sua mensagem', null, 'sent'),
         ($1, $2, 'telegram', 'in', 'm2', 'text', 'Piorou de noite', null, 'received')`,
      [clinic.tenantId, clinic.conversationId],
    );

    const { app } = await buildTestApp({ pool });
    const server = (app as any).getHttpServer();

    const list = await request(server).get('/painel?token=test-panel');
    expect(list.text).toContain('2 nova(s)');

    const detail = await request(server).get(
      `/painel/tickets/${rows[0].id}?token=test-panel`,
    );
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Estou com dor');
    expect(detail.text).toContain('Recebi sua mensagem');
    expect(detail.text).toContain('Piorou de noite');

    const afterRead = await request(server).get('/painel?token=test-panel');
    expect(afterRead.text).not.toContain('nova(s)');

    await app.close();
  });

  it('edits a bot message template and applies it immediately', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const { app } = await buildTestApp({ pool });
    const server = (app as any).getHttpServer();

    const response = await request(server)
      .post('/painel/templates/greeting')
      .type('form')
      .send({ token: 'test-panel', variants: 'Oi! Tudo bem?\nOlá, como posso ajudar?' });

    expect(response.status).toBe(303);

    const stored = await pool.query(
      `select variants from message_templates where tenant_id = $1 and key = 'greeting'`,
      [clinic.tenantId],
    );
    expect(stored.rows[0].variants).toEqual(['Oi! Tudo bem?', 'Olá, como posso ajudar?']);
    expect(pickMessage('greeting')).toBe('Oi! Tudo bem?');

    await app.close();
  });

  it('ignores edits to a locked template', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const { app } = await buildTestApp({ pool });

    const response = await request((app as any).getHttpServer())
      .post('/painel/templates/emergency_protocol')
      .type('form')
      .send({ token: 'test-panel', variants: 'Vá ao dentista quando puder.' });

    expect(response.status).toBe(303);

    const stored = await pool.query(
      `select count(*)::int as n from message_templates where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(stored.rows[0].n).toBe(0);
    expect(pickMessage('emergency_protocol')).toContain('SAMU');

    await app.close();
  });

  it('proposes a reschedule and applies the patient choice', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const scheduling = await seedScheduling(pool, clinic.tenantId);
    await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
      clinic.contactId,
    ]);

    const booked = await buildBookingService(pool).book(bookingInput(clinic, scheduling));
    if (booked.status !== 'BOOKED') throw new Error('setup failed');

    const { app, fakeChannel } = await buildTestApp({ pool });
    const server = (app as any).getHttpServer();

    const proposal = await request(server)
      .post(`/painel/agendamentos/${booked.appointment.id}/propor`)
      .type('form')
      .send({ token: 'test-panel' });

    expect(proposal.status).toBe(303);
    expect(fakeChannel.sent.at(-1)?.text).toContain('Precisamos remarcar');

    await request(server)
      .post(`/webhooks/telegram/${clinic.channelExternalId}`)
      .set('x-telegram-bot-api-secret-token', 'test-secret')
      .send({
        update_id: 900,
        message: {
          message_id: 900,
          date: 1730000000,
          chat: { id: 42 },
          from: { id: 42 },
          text: '1',
        },
      });

    expect(fakeChannel.sent.at(-1)?.text).toContain('Remarcado');

    const rows = await pool.query(
      `select id, status from appointments where tenant_id = $1 order by created_at`,
      [clinic.tenantId],
    );
    expect(rows.rows[0]).toEqual({ id: booked.appointment.id, status: 'CANCELLED' });
    expect(rows.rows[1].status).toBe('BOOKED');

    const stored = await pool.query(
      `select status from reschedule_proposals where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(stored.rows[0].status).toBe('ACCEPTED');

    await app.close();
  });

  it('keeps the appointment when the patient declines the proposal', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const scheduling = await seedScheduling(pool, clinic.tenantId);
    await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
      clinic.contactId,
    ]);

    const booked = await buildBookingService(pool).book(bookingInput(clinic, scheduling));
    if (booked.status !== 'BOOKED') throw new Error('setup failed');

    const { app, fakeChannel } = await buildTestApp({ pool });
    const server = (app as any).getHttpServer();

    await request(server)
      .post(`/painel/agendamentos/${booked.appointment.id}/propor`)
      .type('form')
      .send({ token: 'test-panel' });

    await request(server)
      .post(`/webhooks/telegram/${clinic.channelExternalId}`)
      .set('x-telegram-bot-api-secret-token', 'test-secret')
      .send({
        update_id: 901,
        message: {
          message_id: 901,
          date: 1730000000,
          chat: { id: 42 },
          from: { id: 42 },
          text: 'não',
        },
      });

    expect(fakeChannel.sent.at(-1)?.text).toContain('mantive sua consulta');

    const appointment = await pool.query(
      `select status from appointments where id = $1`,
      [booked.appointment.id],
    );
    expect(appointment.rows[0].status).toBe('BOOKED');

    const stored = await pool.query(
      `select status from reschedule_proposals where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(stored.rows[0].status).toBe('CANCELLED');

    await app.close();
  });

  it('holds the reply in shadow mode and sends it after approval', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
      clinic.contactId,
    ]);
    await pool.query(`update clinics set shadow_mode = true where id = $1`, [clinic.tenantId]);

    const { app, fakeChannel } = await buildTestApp({ pool });
    const server = (app as any).getHttpServer();

    await request(server)
      .post(`/webhooks/telegram/${clinic.channelExternalId}`)
      .set('x-telegram-bot-api-secret-token', 'test-secret')
      .send({
        update_id: 800,
        message: {
          message_id: 800,
          date: 1730000000,
          chat: { id: 42 },
          from: { id: 42 },
          text: '/start',
        },
      });

    expect(fakeChannel.sent).toHaveLength(0);

    const pending = await pool.query(
      `select id from pending_replies where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(pending.rows).toHaveLength(1);

    await request(server)
      .post(`/painel/pendentes/${pending.rows[0].id}/enviar`)
      .type('form')
      .send({ token: 'test-panel' });

    expect(fakeChannel.sent.at(-1)?.text).toContain('secretária virtual');

    const after = await pool.query(
      `select status from pending_replies where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(after.rows[0].status).toBe('SENT');

    await app.close();
  });

  it('lets the emergency protocol bypass shadow mode', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    await pool.query(`update patient_contacts set external_user_id = '42' where id = $1`, [
      clinic.contactId,
    ]);
    await pool.query(`update clinics set shadow_mode = true where id = $1`, [clinic.tenantId]);

    const { app, fakeChannel } = await buildTestApp({ pool });

    await request((app as any).getHttpServer())
      .post(`/webhooks/telegram/${clinic.channelExternalId}`)
      .set('x-telegram-bot-api-secret-token', 'test-secret')
      .send({
        update_id: 801,
        message: {
          message_id: 801,
          date: 1730000000,
          chat: { id: 42 },
          from: { id: 42 },
          text: 'não consigo respirar',
        },
      });

    expect(fakeChannel.sent.at(-1)?.text).toContain('SAMU');

    const pending = await pool.query(
      `select count(*)::int as n from pending_replies where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(pending.rows[0].n).toBe(0);

    await app.close();
  });

  it('toggles shadow mode from the panel', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const { app } = await buildTestApp({ pool });

    await request((app as any).getHttpServer())
      .post('/painel/shadow')
      .type('form')
      .send({ token: 'test-panel', enabled: 'on' });

    const row = await pool.query(`select shadow_mode from clinics where id = $1`, [
      clinic.tenantId,
    ]);
    expect(row.rows[0].shadow_mode).toBe(true);

    await app.close();
  });

  it('closes attendance from the panel', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const scheduling = await seedScheduling(pool, clinic.tenantId);
    const { rows } = await pool.query(
      `insert into appointments
         (tenant_id, patient_contact_id, service_id, location_id, start_at, end_at, status)
       values ($1, $2, $3, $4, now() - interval '2 hours',
               now() - interval '1 hour 20 minutes', 'BOOKED')
       returning id`,
      [clinic.tenantId, clinic.contactId, scheduling.cleaningServiceId, scheduling.locationId],
    );

    const { app } = await buildTestApp({ pool });

    const response = await request((app as any).getHttpServer())
      .post(`/painel/agendamentos/${rows[0].id}/presenca`)
      .type('form')
      .send({ token: 'test-panel', status: 'ATTENDED' });

    expect(response.status).toBe(303);

    const stored = await pool.query(
      `select status, attendance_status from appointments where id = $1`,
      [rows[0].id],
    );
    expect(stored.rows[0]).toEqual({
      status: 'COMPLETED',
      attendance_status: 'ATTENDED',
    });

    await app.close();
  });

  it('adds and removes a working hour', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const scheduling = await seedScheduling(pool, clinic.tenantId);
    const { app } = await buildTestApp({ pool });
    const server = (app as any).getHttpServer();

    const before = await pool.query(
      `select count(*)::int as n from professional_working_hours where tenant_id = $1`,
      [clinic.tenantId],
    );

    await request(server)
      .post('/painel/horarios')
      .type('form')
      .send({
        token: 'test-panel',
        professionalId: scheduling.caioId,
        weekday: '6',
        startTime: '08:00',
        endTime: '12:00',
      });

    const after = await pool.query(
      `select count(*)::int as n from professional_working_hours where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);

    const created = await pool.query(
      `select id from professional_working_hours
       where tenant_id = $1 and weekday = 6 and start_time = '08:00'`,
      [clinic.tenantId],
    );

    await request(server)
      .post(`/painel/horarios/${created.rows[0].id}/excluir`)
      .type('form')
      .send({ token: 'test-panel' });

    const final = await pool.query(
      `select count(*)::int as n from professional_working_hours where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(final.rows[0].n).toBe(before.rows[0].n);

    await app.close();
  });

  it('adds and removes a holiday', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const { app } = await buildTestApp({ pool });
    const server = (app as any).getHttpServer();

    await request(server)
      .post('/painel/feriados')
      .type('form')
      .send({ token: 'test-panel', date: '2026-12-25', name: 'Natal' });

    const created = await pool.query(
      `select id from clinic_holidays where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(created.rows).toHaveLength(1);

    await request(server)
      .post(`/painel/feriados/${created.rows[0].id}/excluir`)
      .type('form')
      .send({ token: 'test-panel' });

    const after = await pool.query(
      `select count(*)::int as n from clinic_holidays where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(after.rows[0].n).toBe(0);

    await app.close();
  });

  it('adds and removes a professional time off', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const scheduling = await seedScheduling(pool, clinic.tenantId);
    const { app } = await buildTestApp({ pool });
    const server = (app as any).getHttpServer();

    await request(server)
      .post('/painel/folgas')
      .type('form')
      .send({
        token: 'test-panel',
        professionalId: scheduling.caioId,
        startDate: '2026-12-01',
        endDate: '2026-12-10',
        reason: 'Férias',
      });

    const created = await pool.query(
      `select id, reason from professional_time_off where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(created.rows).toHaveLength(1);
    expect(created.rows[0].reason).toBe('Férias');

    await request(server)
      .post(`/painel/folgas/${created.rows[0].id}/excluir`)
      .type('form')
      .send({ token: 'test-panel' });

    const after = await pool.query(
      `select count(*)::int as n from professional_time_off where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(after.rows[0].n).toBe(0);

    await app.close();
  });

  it('replies to a ticket from the panel', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const { rows } = await pool.query(
      `insert into human_tickets
         (tenant_id, conversation_id, patient_contact_id, reason, summary, question, sla_due_at)
       values ($1, $2, $3, 'CLINICAL', 'dor', '?', now() + interval '10 minutes')
       returning id`,
      [clinic.tenantId, clinic.conversationId, clinic.contactId],
    );

    const { app, fakeChannel } = await buildTestApp({ pool });
    const response = await request((app as any).getHttpServer())
      .post(`/painel/tickets/${rows[0].id}/responder`)
      .type('form')
      .send({ token: 'test-panel', answer: 'Pode vir amanhã às 9h.' });

    expect(response.status).toBe(303);
    expect(fakeChannel.sent.at(-1)?.text).toBe('Pode vir amanhã às 9h.');

    const ticket = await pool.query(
      `select status, answer from human_tickets where id = $1`,
      [rows[0].id],
    );
    expect(ticket.rows[0]).toEqual({
      status: 'answered',
      answer: 'Pode vir amanhã às 9h.',
    });

    await app.close();
  });

  it('assumes and then closes a ticket from the panel', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const { rows } = await pool.query(
      `insert into human_tickets
         (tenant_id, conversation_id, patient_contact_id, reason, summary, question, sla_due_at)
       values ($1, $2, $3, 'UNKNOWN', 'duvida', '?', now() + interval '10 minutes')
       returning id`,
      [clinic.tenantId, clinic.conversationId, clinic.contactId],
    );

    const { app } = await buildTestApp({ pool });
    const server = (app as any).getHttpServer();

    await request(server)
      .post(`/painel/tickets/${rows[0].id}/assumir`)
      .type('form')
      .send({ token: 'test-panel' });

    const accepted = await pool.query(
      `select accepted_at from human_tickets where id = $1`,
      [rows[0].id],
    );
    expect(accepted.rows[0].accepted_at).not.toBeNull();

    const stateAfterAccept = await pool.query(
      `select state from conversations where id = $1`,
      [clinic.conversationId],
    );
    expect(stateAfterAccept.rows[0].state).toBe('HUMAN_ACTIVE');

    await request(server)
      .post(`/painel/tickets/${rows[0].id}/encerrar`)
      .type('form')
      .send({ token: 'test-panel' });

    const closed = await pool.query(
      `select status from human_tickets where id = $1`,
      [rows[0].id],
    );
    expect(closed.rows[0].status).toBe('resolved');

    const stateAfterClose = await pool.query(
      `select state from conversations where id = $1`,
      [clinic.conversationId],
    );
    expect(stateAfterClose.rows[0].state).toBe('ACTIVE');

    await app.close();
  });
});
