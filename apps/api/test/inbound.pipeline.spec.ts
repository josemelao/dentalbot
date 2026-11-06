import { UnknownRouter } from '../src/ai/unknown-router';
import { KnowledgeRepository } from '../src/db/repositories/knowledge.repository';
import { getTestPool, seedClinic, seedKnowledge } from './helpers/db';
import { buildInboundService } from './helpers/services';

const message = (overrides: Partial<any> = {}) => ({
  tenantId: '',
  channel: 'telegram' as const,
  externalChannelId: '',
  externalUserId: 'user-1',
  externalConversationId: 'user-1',
  externalMessageId: 'm-1',
  messageType: 'text' as const,
  content: 'Olá',
  media: null,
  receivedAt: new Date(),
  ...overrides,
});

describe('InboundService', () => {
  it('creates a provisional contact, conversation and inbound message', async () => {
    const pool = getTestPool();
    const { tenantId, channelExternalId: externalChannelId } = await seedClinic(pool);
    const service = buildInboundService(pool);
    const result = await service.handle(message({ tenantId, externalChannelId }), 'corr-1');

    expect(result.status).toBe('COMPLETED');
    expect(result.data!.contact.externalUserId).toBe('user-1');
    expect(result.data!.humanActive).toBe(false);

    const { rows } = await pool.query(
      `select count(*)::int as n from messages where tenant_id = $1 and direction = 'in'`,
      [tenantId],
    );
    expect(rows[0].n).toBe(1);

    const audit = await pool.query(
      `select count(*)::int as n from audit_logs
       where tenant_id = $1 and action = 'inbound_message_received'`,
      [tenantId],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('reuses an existing contact and conversation', async () => {
    const pool = getTestPool();
    const { tenantId, channelExternalId: externalChannelId } = await seedClinic(pool);
    const service = buildInboundService(pool);
    const first = await service.handle(message({ tenantId, externalChannelId }), 'c1');
    const second = await service.handle(
      message({ tenantId, externalChannelId, externalMessageId: 'm-2' }),
      'c2',
    );

    expect(second.data!.contact.id).toBe(first.data!.contact.id);
    expect(second.data!.conversation.id).toBe(first.data!.conversation.id);
  });

  it('sets HUMAN_ACTIVE when a human accepted the ticket', async () => {
    const pool = getTestPool();
    const { tenantId, channelExternalId: externalChannelId, conversationId, contactId } =
      await seedClinic(pool, { withConversation: true });
    await pool.query(
      `insert into human_tickets
         (tenant_id, conversation_id, patient_contact_id, reason, summary, question, sla_due_at, accepted_at)
       values ($1, $2, $3, 'CLINICAL', 'dor', 'pode agendar?', now() + interval '15 minutes', now())`,
      [tenantId, conversationId, contactId],
    );

    const service = buildInboundService(pool);
    const result = await service.handle(
      message({ tenantId, externalChannelId, externalUserId: 'user-pilot' }),
      'c1',
    );

    expect(result.data!.humanActive).toBe(true);
    const { rows } = await pool.query(`select state from conversations where id = $1`, [
      conversationId,
    ]);
    expect(rows[0].state).toBe('HUMAN_ACTIVE');
  });

  it('answers through the router instead of opening a ticket', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool);
    await seedKnowledge(pool, ids.tenantId, [
      {
        category: 'logistica',
        question: 'Vocês abrem no sábado?',
        answer: 'Não abrimos no sábado.',
        keywords: ['sabado'],
        status: 'approved',
      },
    ]);
    const { rows } = await pool.query(
      `select id from knowledge_entries where tenant_id = $1`,
      [ids.tenantId],
    );

    const router = new UnknownRouter({
      client: {
        provider: 'fake',
        model: 'fake-router',
        async complete() {
          return JSON.stringify({ route: 'FAQ', entryId: rows[0].id, confidence: 0.9 });
        },
      },
      knowledge: new KnowledgeRepository(pool),
      confidenceThreshold: 0.6,
      now: () => new Date(),
    });

    const service = buildInboundService(pool, { router });
    const result = await service.handle(
      message({
        tenantId: ids.tenantId,
        externalChannelId: ids.channelExternalId,
        content: 'vocês funcionam no sábado?',
      }),
      'corr-router',
    );

    expect(result.status).toBe('COMPLETED');

    const tickets = await pool.query(
      `select count(*)::int as n from human_tickets where tenant_id = $1`,
      [ids.tenantId],
    );
    expect(tickets.rows[0].n).toBe(0);

    const out = await pool.query(
      `select content from messages where tenant_id = $1 and direction = 'out'`,
      [ids.tenantId],
    );
    expect(out.rows[0].content).toBe('Não abrimos no sábado.');
  });

  it('fails safely when the channel is not configured', async () => {
    const pool = getTestPool();
    await seedClinic(pool, { suffix: 'a' });
    const service = buildInboundService(pool);
    const result = await service.handle(
      message({ tenantId: '00000000-0000-0000-0000-000000000000' }),
      'c1',
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('CHANNEL_NOT_FOUND');
  });
});
