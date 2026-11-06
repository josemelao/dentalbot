import { mapTelegramUpdate } from './telegram.mapper';

describe('mapTelegramUpdate', () => {
  const ctx = { tenantId: 'tenant-1', externalChannelId: 'bot-1' };
  const base = { message_id: 2, date: 1730000000, chat: { id: 3 }, from: { id: 3 } };

  it('maps text', () => {
    const mapped = mapTelegramUpdate({ update_id: 1, message: { ...base, text: 'oi' } }, ctx);
    expect(mapped).toMatchObject({
      tenantId: 'tenant-1',
      externalChannelId: 'bot-1',
      externalUserId: '3',
      externalConversationId: '3',
      externalMessageId: '2',
      messageType: 'text',
      content: 'oi',
      media: null,
    });
  });

  it('maps a photo to image with no content', () => {
    const mapped = mapTelegramUpdate(
      { update_id: 1, message: { ...base, photo: [{ file_id: 'f1' }] } },
      ctx,
    );
    expect(mapped).toMatchObject({ messageType: 'image', content: null });
  });

  it('returns null for a non-message update', () => {
    expect(mapTelegramUpdate({ update_id: 1, edited_message: {} }, ctx)).toBeNull();
  });

  it('strips the bot mention from a command', () => {
    const mapped = mapTelegramUpdate(
      { update_id: 1, message: { ...base, text: '/start@DentalAssistAppBot' } },
      ctx,
    );
    expect(mapped?.content).toBe('/start');
  });

  it('keeps the command payload untouched', () => {
    const mapped = mapTelegramUpdate(
      { update_id: 1, message: { ...base, text: '/start demo' } },
      ctx,
    );
    expect(mapped?.content).toBe('/start demo');
  });
});
