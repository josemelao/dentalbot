import { ResponseComposer } from './composer.service';

describe('ResponseComposer', () => {
  const composer = new ResponseComposer();

  it('returns null while a human owns the conversation', () => {
    expect(composer.compose({ kind: 'HUMAN_ACTIVE_SILENT' }, { slaMinutes: 15 })).toBeNull();
  });

  it('includes the SLA in the holding message', () => {
    const text = composer.compose(
      { kind: 'HOLDING_ESCALATED', ticket: { id: 't' } as never },
      { slaMinutes: 15 },
    );
    expect(text).toContain('15 minutos');
  });

  it('never paraphrases an approved answer', () => {
    const text = composer.compose(
      { kind: 'ANSWER_FAQ', entry: { answer: 'Rua A, 100' } as never },
      { slaMinutes: 15 },
    );
    expect(text).toBe('Rua A, 100');
  });

  it('does not claim the team was notified when delivery is best-effort', () => {
    const text = composer.compose(
      { kind: 'EMERGENCY_PROTOCOL', rule: 'airway' },
      { slaMinutes: 15 },
    );
    expect(text).toContain('SAMU');
    expect(text).not.toContain('Já avisei');
  });
});
