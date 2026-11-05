import { getTestPool, seedClinic, seedKnowledge } from './helpers/db';
import { ChannelsRepository } from '../src/db/repositories/channels.repository';
import { PatientsRepository } from '../src/db/repositories/patients.repository';
import { ConversationsRepository } from '../src/db/repositories/conversations.repository';
import { MessagesRepository } from '../src/db/repositories/messages.repository';

describe('tenant isolation', () => {
  it('resolves a channel to exactly one tenant', async () => {
    const pool = getTestPool();
    const a = await seedClinic(pool, { suffix: 'a' });
    const b = await seedClinic(pool, { suffix: 'b' });
    const repo = new ChannelsRepository(pool);
    const found = await repo.findByExternalId('telegram', `bot-${b.suffix}`);
    expect(found?.tenantId).toBe(b.tenantId);
    expect(found?.tenantId).not.toBe(a.tenantId);
  });

  it('never returns another tenant contact', async () => {
    const pool = getTestPool();
    const a = await seedClinic(pool, { suffix: 'a' });
    const b = await seedClinic(pool, { suffix: 'b' });
    const repo = new PatientsRepository(pool);
    await repo.createProvisionalContact({
      tenantId: b.tenantId,
      channel: 'telegram',
      externalUserId: 'user-b',
    });
    expect(await repo.findContact(a.tenantId, 'telegram', 'user-b')).toBeNull();
  });

  it('cannot append a message to another tenant conversation', async () => {
    const pool = getTestPool();
    const a = await seedClinic(pool, { suffix: 'a', withConversation: true });
    const b = await seedClinic(pool, { suffix: 'b' });
    const conversations = new ConversationsRepository(pool);
    const messages = new MessagesRepository(pool);

    await expect(
      messages.appendInbound({
        tenantId: b.tenantId,
        conversationId: a.conversationId!,
        channel: 'telegram',
        externalMessageId: 'x-1',
        messageType: 'text',
        content: 'oi',
        media: null,
      }),
    ).rejects.toThrow(/foreign key/);

    await expect(
      conversations.updateState(b.tenantId, a.conversationId!, 'CLOSED'),
    ).resolves.toBeUndefined();

    const { rows } = await pool.query(`select state from conversations where id = $1`, [
      a.conversationId,
    ]);
    expect(rows[0].state).toBe('ACTIVE');
  });

  it('seeds knowledge only for the requested tenant', async () => {
    const pool = getTestPool();
    const a = await seedClinic(pool, { suffix: 'a' });
    const b = await seedClinic(pool, { suffix: 'b' });
    await seedKnowledge(pool, a.tenantId, [
      {
        category: 'logistica',
        question: 'Onde fica?',
        answer: 'Rua A, 100',
        keywords: ['endereco'],
      },
    ]);
    const aCount = await pool.query(
      `select count(*)::int as n from knowledge_entries where tenant_id = $1`,
      [a.tenantId],
    );
    const bCount = await pool.query(
      `select count(*)::int as n from knowledge_entries where tenant_id = $1`,
      [b.tenantId],
    );
    expect(aCount.rows[0].n).toBe(1);
    expect(bCount.rows[0].n).toBe(0);
  });
});
