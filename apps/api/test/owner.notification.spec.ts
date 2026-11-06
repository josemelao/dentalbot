import { ChannelAdapter } from '../src/channels/channel-adapter';
import { FakeChannelAdapter } from '../src/channels/fake/fake-channel.adapter';
import { ChannelOwnerNotifier, RecordingOwnerNotifier } from '../src/channels/owner-notifier';
import { AuditRepository } from '../src/db/repositories/audit.repository';
import { ChannelsRepository } from '../src/db/repositories/channels.repository';
import { ConversationsRepository } from '../src/db/repositories/conversations.repository';
import { PatientsRepository } from '../src/db/repositories/patients.repository';
import { TicketsRepository } from '../src/db/repositories/tickets.repository';
import { EscalationService } from '../src/pipeline/escalation.service';
import { formatPatientLabel, formatTicketCard } from '../src/pipeline/ticket-card';
import { getTestPool, seedClinic } from './helpers/db';

describe('owner notification', () => {
  it('sends the ticket card to every linked owner', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool, { withConversation: true });
    const notifier = new RecordingOwnerNotifier();

    const service = new EscalationService({
      tickets: new TicketsRepository(pool),
      channels: new ChannelsRepository(pool),
      conversations: new ConversationsRepository(pool),
      patients: new PatientsRepository(pool),
      audit: new AuditRepository(pool),
      notifier,
      ownerChannel: 'telegram',
      slaMinutes: 15,
    });

    const ticket = await service.create({
      tenantId: ids.tenantId,
      conversationId: ids.conversationId!,
      patientContactId: ids.contactId!,
      reason: 'CLINICAL',
      summary: 'Paciente relata dor',
      question: 'Estou com dor de dente',
    });

    expect(notifier.deliveries.map((delivery) => delivery.ownerId).sort()).toEqual(
      [ids.ownerId, ids.dentistId].sort(),
    );

    const card = notifier.deliveries[0].text;
    expect(card).toContain(`[TICKET #${ticket.id.slice(0, 8)}]`);
    expect(card).toContain('Motivo: Relato clínico');
    expect(card).toContain('Estou com dor de dente');
    expect(card).toContain('1) Assumir a conversa');
    expect(card).toContain('3) Responder ao paciente');

    expect(ticket.status).toBe('notified');
  });

  it('delivers to each recipient and survives a single failure', async () => {
    const failing: ChannelAdapter = {
      channel: 'telegram',
      async send() {
        throw new Error('blocked by user');
      },
    };
    const healthy = new FakeChannelAdapter();

    const notifier = new ChannelOwnerNotifier({
      channel: 'telegram',
      async send(message) {
        if (message.externalUserId === 'blocked') return failing.send(message);
        return healthy.send(message);
      },
    });

    const result = await notifier.notify(
      {
        ticket: { id: 'ticket-1' } as never,
        patientLabel: 'Maria',
        text: 'card',
      },
      [
        { userId: 'u1', name: 'Chow', externalUserId: 'blocked' },
        { userId: 'u2', name: 'Caio', externalUserId: 'ok' },
      ],
    );

    expect(result.deliveredTo).toEqual(['u2']);
    expect(healthy.sent).toEqual([{ externalUserId: 'ok', text: 'card' }]);
  });

  it('masks the contact id when there is no display name', () => {
    expect(formatPatientLabel(null, '5511999998888')).toBe('contato •••8888');
    expect(formatPatientLabel('Maria', '5511999998888')).toBe('Maria');
  });

  it('truncates a very long question in the card', () => {
    const card = formatTicketCard(
      {
        id: 'abcdef123456',
        reason: 'UNKNOWN',
        question: 'x'.repeat(500),
        slaDueAt: new Date('2026-11-06T15:30:00Z'),
      } as never,
      'Maria',
    );
    expect(card).toContain('…');
    expect(card.length).toBeLessThan(600);
  });
});
