import { redactMessage, redactPhone } from './redact';

describe('redactPhone', () => {
  it('keeps only the last four digits', () => {
    expect(redactPhone('5511999999999')).toBe('*********9999');
  });
});

describe('redactMessage', () => {
  it('hides the body and keeps the length', () => {
    expect(redactMessage('oi')).toBe('[redacted:2]');
  });
});
