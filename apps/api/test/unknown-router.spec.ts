import { buildRouterPrompt, UnknownRouter } from '../src/ai/unknown-router';
import { LlmClient } from '../src/ai/llm-client';
import { KnowledgeRepository } from '../src/db/repositories/knowledge.repository';
import { getTestPool, seedClinic, seedKnowledge } from './helpers/db';

const client = (response: string, capture?: { system?: string; user?: string }): LlmClient => ({
  provider: 'fake',
  model: 'fake-router',
  async complete(request) {
    if (capture) {
      capture.system = request.system;
      capture.user = request.user;
    }
    return response;
  },
});

const build = (pool: any, response: string, capture?: { system?: string; user?: string }) =>
  new UnknownRouter({
    client: client(response, capture),
    knowledge: new KnowledgeRepository(pool),
    confidenceThreshold: 0.6,
    now: () => new Date(),
  });

const input = (tenantId: string, text: string) => ({
  tenantId,
  text,
  recentMessages: [],
});

describe('UnknownRouter', () => {
  it('routes to an approved entry and returns it', async () => {
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

    const { rows } = await pool.query(`select id from knowledge_entries where tenant_id = $1`, [
      ids.tenantId,
    ]);

    const router = build(
      pool,
      JSON.stringify({ route: 'FAQ', entryId: rows[0].id, confidence: 0.9 }),
    );
    const result = await router.resolve(input(ids.tenantId, 'vocês funcionam no sábado?'));

    expect(result?.route).toBe('FAQ');
    if (result?.route === 'FAQ') {
      expect(result.entry.answer).toBe('Não abrimos no sábado.');
    }
  });

  it('falls back to a human when the entry does not exist', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool);
    const router = build(
      pool,
      JSON.stringify({ route: 'FAQ', entryId: '00000000-0000-0000-0000-000000000000', confidence: 0.9 }),
    );

    expect(await router.resolve(input(ids.tenantId, 'qualquer coisa'))).toEqual({
      route: 'HUMAN',
    });
  });

  it('falls back to a human on low confidence', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool);
    const router = build(pool, JSON.stringify({ route: 'SCHEDULE', confidence: 0.3 }));

    expect(await router.resolve(input(ids.tenantId, 'talvez'))).toEqual({ route: 'HUMAN' });
  });

  it('returns null when the model answers garbage', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool);
    const router = build(pool, 'desculpe, não sei');

    expect(await router.resolve(input(ids.tenantId, '???') )).toBeNull();
  });

  it('routes to the scheduling flow', async () => {
    const pool = getTestPool();
    const ids = await seedClinic(pool);
    const router = build(pool, JSON.stringify({ route: 'SCHEDULE', confidence: 0.95 }));

    expect(await router.resolve(input(ids.tenantId, 'consegue me encaixar quinta?'))).toEqual({
      route: 'SCHEDULE',
    });
  });

  it('tells the model the message is untrusted and lists the entries', () => {
    const { system, user } = buildRouterPrompt(
      { tenantId: 't', text: 'oi', recentMessages: [] },
      [
        {
          id: 'e1',
          tenantId: 't',
          category: 'x',
          question: 'Pergunta',
          answer: 'Resposta',
          keywords: ['k'],
          status: 'approved',
          validFrom: new Date(),
          validTo: null,
        } as never,
      ],
    );

    expect(system).toContain('untrusted');
    expect(system).toContain('never answer the patient');
    expect(user).toContain('e1');
    expect(user).toContain('Pergunta');
  });
});
