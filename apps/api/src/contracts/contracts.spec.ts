import { NormalizedMessageSchema, normalizePhone } from './normalized-message';
import { ProcessingResultSchema } from './processing-result';

describe('normalizePhone', () => {
  it.each([
    ['(11) 99999-9999', '5511999999999'],
    ['+55 11 99999-9999', '5511999999999'],
    ['5511999999999', '5511999999999'],
    ['11999999999', '5511999999999'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('rejects garbage', () => {
    expect(() => normalizePhone('abc')).toThrow(/invalid phone/);
  });
});

describe('NormalizedMessageSchema', () => {
  const valid = {
    tenantId: '00000000-0000-0000-0000-000000000001',
    channel: 'telegram',
    externalChannelId: 'bot-1',
    externalUserId: '42',
    externalConversationId: '42',
    externalMessageId: 'm-1',
    messageType: 'text',
    content: 'Olá',
    media: null,
    receivedAt: new Date().toISOString(),
  };

  it('accepts a valid message', () => {
    expect(NormalizedMessageSchema.parse(valid)).toMatchObject({ channel: 'telegram' });
  });

  it('rejects empty text', () => {
    expect(NormalizedMessageSchema.safeParse({ ...valid, content: '' }).success).toBe(false);
  });

  it('accepts an unsupported media message without content', () => {
    expect(
      NormalizedMessageSchema.safeParse({
        ...valid,
        messageType: 'image',
        content: null,
        media: { kind: 'image', fileId: 'f1' },
      }).success,
    ).toBe(true);
  });
});

describe('ProcessingResultSchema', () => {
  it('rejects an unknown status', () => {
    expect(
      ProcessingResultSchema.safeParse({
        success: true,
        status: 'DONE',
        data: null,
        error: null,
        correlationId: 'c',
      }).success,
    ).toBe(false);
  });
});
