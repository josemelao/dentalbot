import { FakeChannelAdapter } from '../src/channels/fake/fake-channel.adapter';
import { RecordingOwnerNotifier } from '../src/channels/owner-notifier';
import { AuditRepository } from '../src/db/repositories/audit.repository';
import { ChannelsRepository } from '../src/db/repositories/channels.repository';
import { ConversationsRepository } from '../src/db/repositories/conversations.repository';
import { MessagesRepository } from '../src/db/repositories/messages.repository';
import { PatientsRepository } from '../src/db/repositories/patients.repository';
import { TicketsRepository } from '../src/db/repositories/tickets.repository';
import { EscalationService } from '../src/pipeline/escalation.service';
import { IdleTicketService } from '../src/pipeline/idle-ticket.service';
import { getTestPool, seedClinic } from './helpers/db';

const build = (pool: any) => {
  const notifier = new RecordingOwnerNotifier();
  const escalation = new EscalationService({
    tickets: new TicketsRepository(pool),
    channels: new ChannelsRepository(pool),
    conversations: new ConversationsRepository(pool),
    patients: new PatientsRepository(pool),
    messages: new MessagesRepository(pool),
    audit: new AuditRepository(pool),
    notifier,
    ownerChannel: 'telegram',
    channel: new FakeChannelAdapter(),
    slaMinutes: 15,
  });

  return {
    notifier,
    service: new IdleTicketService({
      tickets: new TicketsRepository(pool),
      escalation,
      now: () => new Date(),
      idleMinutes: 30,
    }),
  };
};

const seedAcceptedTicket = async (
  pool: any,
  options: { minutesAgo?: number; humanReplied?: boolean } = {},
) => {
  const clinic = await seedClinic(pool, { withConversation: true });
  const minutes = options.minutesAgo ?? 45;

  const { rows } = await pool.query(
    `insert into human_tickets
       (tenant_id, conversation_id, patient_contact_id, reason, summary, question,
        sla_due_at, accepted_at)
     values ($1, $2, $3, 'CLINICAL', 'dor', '?',
             now() + interval '15 minutes', now() - ($4 || ' minutes')::interval)
     returning id`,
    [clinic.tenantId, clinic.conversationId, clinic.contactId, String(minutes)],
  );

  if (options.humanReplied) {
    await pool.query(
      `insert into messages
         (tenant_id, conversation_id, channel, direction, external_message_id,
          message_type, content, media, delivery_status, created_at)
       values ($1, $2, 'telegram', 'out', null, 'text', 'Já te respondo', null, 'sent',
               now() - interval '10 minutes')`,
      [clinic.tenantId, clinic.conversationId],
    );
  }

  return { clinic, ticketId: rows[0].id as string };
};

describe('IdleTicketService', () => {
  it('warns the owners when an accepted ticket is waiting', async () => {
    const pool = getTestPool();
    const { clinic, ticketId } = await seedAcceptedTicket(pool);
    const { service, notifier } = build(pool);

    const result = await service.sweepTenant(clinic.tenantId);

    expect(result).toEqual({ tenantId: clinic.tenantId, idle: 1, alerted: 1 });
    expect(notifier.deliveries).toHaveLength(2);
    expect(notifier.deliveries[0].text).toContain('Assumido há 30 min sem resposta');

    const events = await pool.query(
      `select event from ticket_events where ticket_id = $1`,
      [ticketId],
    );
    expect(events.rows).toEqual([{ event: 'idle_alert' }]);
  });

  it('alerts only once per idle period', async () => {
    const pool = getTestPool();
    const { clinic } = await seedAcceptedTicket(pool);
    const { service, notifier } = build(pool);

    await service.sweepTenant(clinic.tenantId);
    const second = await service.sweepTenant(clinic.tenantId);

    expect(second.idle).toBe(0);
    expect(notifier.deliveries).toHaveLength(2);
  });

  it('does not warn when the human already replied', async () => {
    const pool = getTestPool();
    const { clinic } = await seedAcceptedTicket(pool, { humanReplied: true });
    const { service, notifier } = build(pool);

    const result = await service.sweepTenant(clinic.tenantId);

    expect(result.idle).toBe(0);
    expect(notifier.deliveries).toHaveLength(0);
  });

  it('does not warn before the idle window', async () => {
    const pool = getTestPool();
    const { clinic } = await seedAcceptedTicket(pool, { minutesAgo: 5 });
    const { service } = build(pool);

    const result = await service.sweepTenant(clinic.tenantId);

    expect(result.idle).toBe(0);
  });
});
