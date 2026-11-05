import { Pool } from 'pg';
import { getTestPool, seedClinic } from './helpers/db';
import { AuditRepository } from '../src/db/repositories/audit.repository';
import { ChannelsRepository } from '../src/db/repositories/channels.repository';
import { ConversationsRepository } from '../src/db/repositories/conversations.repository';
import { TicketsRepository } from '../src/db/repositories/tickets.repository';
import { RecordingOwnerNotifier } from '../src/channels/owner-notifier';
import { EscalationService } from '../src/pipeline/escalation.service';

const build = (pool: Pool, notifier = new RecordingOwnerNotifier()) => ({
  notifier,
  service: new EscalationService({
    tickets: new TicketsRepository(pool),
    channels: new ChannelsRepository(pool),
    conversations: new ConversationsRepository(pool),
    audit: new AuditRepository(pool),
    notifier,
    slaMinutes: 15,
  }),
});

const input = (ids: {
  tenantId: string;
  conversationId?: string;
  contactId?: string;
}) => ({
  tenantId: ids.tenantId,
  conversationId: ids.conversationId!,
  patientContactId: ids.contactId!,
  reason: 'CLINICAL' as const,
  summary: 'Paciente relata dor no dente',
  question: 'Pode agendar avaliação?',
});

describe('EscalationService', () => {
  it('creates a ticket with reason, summary, question and SLA', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool, { withConversation: true });
    const { service } = build(pool);
    const ticket = await service.create(input(ids));

    expect(ticket.reason).toBe('CLINICAL');
    expect(ticket.summary).toBe('Paciente relata dor no dente');
    expect(ticket.question).toBe('Pode agendar avaliação?');
    expect(ticket.slaDueAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

    const { rows } = await pool.query(`select state from conversations where id = $1`, [
      ids.conversationId,
    ]);
    expect(rows[0].state).toBe('REQUIRES_HUMAN');

    const events = await pool.query(
      `select event from ticket_events where ticket_id = $1 order by created_at`,
      [ticket.id],
    );
    expect(events.rows.map((row: { event: string }) => row.event)).toEqual(['created', 'notified']);

    const audit = await pool.query(
      `select count(*)::int as n from audit_logs
       where action = 'ticket_created' and entity_id = $1`,
      [ticket.id],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('notifies every active owner and dentist', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool, { withConversation: true });
    const { service, notifier } = build(pool);
    await service.create(input(ids));

    expect(notifier.deliveries.map((delivery) => delivery.ownerId).sort()).toEqual(
      [ids.ownerId, ids.dentistId].sort(),
    );
  });

  it('keeps the ticket open when notification fails', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool, { withConversation: true });
    const notifier = new RecordingOwnerNotifier();
    notifier.failed = true;
    const { service } = build(pool, notifier);

    const ticket = await service.create(input(ids));
    expect(ticket.status).toBe('open');

    const events = await pool.query(`select event from ticket_events where ticket_id = $1`, [
      ticket.id,
    ]);
    expect(events.rows.map((row: { event: string }) => row.event)).toEqual(['created']);
  });

  it('returns the existing open ticket for the same conversation', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool, { withConversation: true });
    const { service } = build(pool);

    const first = await service.create(input(ids));
    const second = await service.create(input(ids));
    expect(second.id).toBe(first.id);
  });
});
