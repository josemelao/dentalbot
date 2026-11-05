import { getTestPool, seedClinic, seedKnowledge } from './helpers/db';
import { KnowledgeRepository } from '../src/db/repositories/knowledge.repository';
import { FaqService } from '../src/pipeline/faq.service';

const build = (pool: Parameters<typeof seedClinic>[0]) =>
  new FaqService(new KnowledgeRepository(pool));

describe('FaqService', () => {
  it('answers from an approved entry', async () => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    await seedKnowledge(pool, tenantId, [
      {
        category: 'logistica',
        question: 'Qual o horário de funcionamento?',
        answer: 'Atendemos de segunda a sexta, das 9h às 18h.',
        keywords: ['horario de funcionamento', 'que horas abre'],
      },
    ]);

    const result = await build(pool).answer(tenantId, 'Qual o horário de funcionamento?');
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.entry.answer).toBe('Atendemos de segunda a sexta, das 9h às 18h.');
      expect(result.entry.id).toBeTruthy();
    }
  });

  it.each([
    ['draft', { status: 'draft' as const }],
    ['retired', { status: 'retired' as const }],
    ['expired', { validTo: new Date('2026-02-01T00:00:00Z') }],
  ])('does not answer from a %s entry', async (_label, overrides) => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    await seedKnowledge(pool, tenantId, [
      {
        category: 'logistica',
        question: 'Qual o horário de funcionamento?',
        answer: 'Atendemos de segunda a sexta.',
        keywords: ['que horas abre'],
        validFrom: new Date('2026-01-01T00:00:00Z'),
        ...overrides,
      },
    ]);

    const result = await build(pool).answer(
      tenantId,
      'que horas abre?',
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(result).toEqual({ found: false, reason: 'NO_APPROVED_ENTRY' });
  });

  it('does not answer an unrelated question', async () => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    const result = await build(pool).answer(tenantId, 'vocês fazem implante?');
    expect(result).toEqual({ found: false, reason: 'NO_APPROVED_ENTRY' });
  });

  it('never returns an entry from another tenant', async () => {
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

    const result = await build(pool).answer(b.tenantId, 'qual o endereco?');
    expect(result).toEqual({ found: false, reason: 'NO_APPROVED_ENTRY' });
  });
});
