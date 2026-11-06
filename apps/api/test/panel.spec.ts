import request from 'supertest';
import { buildTestApp } from './helpers/app';
import { getTestPool, seedClinic, seedKnowledge, seedScheduling } from './helpers/db';

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
