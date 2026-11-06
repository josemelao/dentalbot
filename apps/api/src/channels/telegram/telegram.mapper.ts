import { MessageType } from '../../contracts/channel';
import { NormalizedMessage } from '../../contracts/normalized-message';

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number };
  from?: { id: number; first_name?: string };
  text?: string;
  voice?: unknown;
  audio?: unknown;
  photo?: unknown;
  document?: unknown;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: unknown;
}

function classify(message: TelegramMessage): MessageType {
  if (typeof message.text === 'string') return 'text';
  if (message.voice || message.audio) return 'audio';
  if (message.photo) return 'image';
  if (message.document) return 'document';
  return 'unsupported';
}

/**
 * In groups and with some clients Telegram delivers `/start@SomeBot`. Strip the
 * bot mention so the command still matches the intent rules.
 */
function normalizeCommand(text: string): string {
  return text.replace(/^(\/[a-z0-9_]+)@[a-z0-9_]+/i, '$1');
}

export function mapTelegramUpdate(
  update: unknown,
  ctx: { tenantId: string; externalChannelId: string },
): NormalizedMessage | null {
  const parsed = update as TelegramUpdate;
  if (!parsed.message) return null;

  const message = parsed.message;
  const messageType = classify(message);

  return {
    tenantId: ctx.tenantId,
    channel: 'telegram',
    externalChannelId: ctx.externalChannelId,
    externalUserId: String(message.from?.id ?? message.chat.id),
    externalConversationId: String(message.chat.id),
    externalMessageId: String(message.message_id),
    messageType,
    content:
      messageType === 'text' && typeof message.text === 'string'
        ? normalizeCommand(message.text)
        : null,
    media: messageType === 'text' ? null : { kind: messageType },
    receivedAt: new Date(message.date * 1000),
  };
}
