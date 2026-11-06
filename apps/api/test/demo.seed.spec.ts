import { getTestPool, seedClinic } from './helpers/db';
import { linkDemoPatient, resetDemoConversation } from '../src/seed/demo';

describe('demo helpers', () => {
  it('resets the conversation and cancels open tickets', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool, { withConversation: true });

    await pool.query(
      `insert into human_tickets
         (tenant_id, conversation_id, patient_contact_id, reason, summary, question, sla_due_at)
       values ($1, $2, $3, 'UNKNOWN', 'ticket aberto', '?', now() + interval '15 minutes')`,
      [ids.tenantId, ids.conversationId, ids.contactId],
    );
    await pool.query(
      `update conversations set state = 'HUMAN_ACTIVE', context = '{"flow":"SCHEDULE"}' where id = $1`,
      [ids.conversationId],
    );

    const result = await resetDemoConversation(pool, `user-${ids.suffix}`);
    expect(result.cancelledTickets).toBe(1);
    expect(result.openAppointments).toBe(0);

    const conversation = await pool.query(
      `select state, context from conversations where id = $1`,
      [ids.conversationId],
    );
    expect(conversation.rows[0]).toEqual({ state: 'ACTIVE', context: {} });

    const ticket = await pool.query(
      `select status from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(ticket.rows).toEqual([{ status: 'cancelled' }]);
  });

  it('links a patient so the identity check can pass', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool, { withConversation: true });

    const result = await linkDemoPatient(
      pool,
      `user-${ids.suffix}`,
      'Maria Silva',
      '1990-05-10',
    );
    expect(result.fullName).toBe('Maria Silva');

    const contact = await pool.query(
      `select pc.patient_id as "patientId", p.full_name as "fullName",
              p.birth_date::text as "birthDate"
       from patient_contacts pc
       join patients p on p.id = pc.patient_id
       where pc.id = $1`,
      [ids.contactId],
    );
    expect(contact.rows[0]).toEqual({
      patientId: result.patientId,
      fullName: 'Maria Silva',
      birthDate: '1990-05-10',
    });
  });

  it('rejects an unknown contact with a helpful error', async () => {
    const pool = getTestPool();
    await expect(resetDemoConversation(pool, 'nobody-here')).rejects.toThrow(
      /Send a message to the bot first/,
    );
  });
});
