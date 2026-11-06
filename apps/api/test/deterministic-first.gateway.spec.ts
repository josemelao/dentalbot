import { DeterministicFirstGateway } from '../src/ai/deterministic-first.gateway';
import { FakeAiGateway } from '../src/ai/fake-ai.gateway';

const request = (text: string) => ({
  tenantId: 't',
  conversationId: null,
  messageId: null,
  text,
  recentMessages: [],
});

describe('DeterministicFirstGateway', () => {
  it('answers a rule match without calling the model', async () => {
    const inner = new FakeAiGateway([{ when: /qualquer/, intent: 'HUMAN_REQUEST' }]);
    const gateway = new DeterministicFirstGateway(inner, [
      { when: /horario/i, intent: 'FAQ_ADMIN' },
    ]);

    const result = await gateway.classifyIntent(request('qual o horario?'));

    expect(result.intent).toBe('FAQ_ADMIN');
    expect(result.rationale).toBe('deterministic');
    expect(inner.sent).toHaveLength(0);
  });

  it('falls through to the model on the residue', async () => {
    const inner = new FakeAiGateway([{ when: /encaixar/, intent: 'SCHEDULE_REQUEST' }]);
    const gateway = new DeterministicFirstGateway(inner, [
      { when: /horario/i, intent: 'FAQ_ADMIN' },
    ]);

    const result = await gateway.classifyIntent(request('dá pra encaixar uma limpeza?'));
    expect(result.intent).toBe('SCHEDULE_REQUEST');
    expect(inner.sent).toHaveLength(1);
  });

  it('keeps the inner provider metadata', () => {
    const inner = new FakeAiGateway();
    const gateway = new DeterministicFirstGateway(inner, []);
    expect(gateway.provider).toBe(inner.provider);
    expect(gateway.model).toBe(inner.model);
    expect(gateway.promptVersion).toBe(inner.promptVersion);
  });
});
