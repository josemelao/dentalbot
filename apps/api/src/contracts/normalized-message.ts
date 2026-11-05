import { z } from 'zod';
import { Channel, MessageType } from './channel';

export class InvalidPhoneError extends Error {
  constructor(value: string) {
    super(`invalid phone: ${value}`);
    this.name = 'InvalidPhoneError';
  }
}

export function normalizePhone(raw: string, defaultCountryCode = '55'): string {
  const digits = raw.replace(/\D/g, '');

  if (defaultCountryCode === '55') {
    if (digits.length === 10 || digits.length === 11) {
      return `55${digits}`;
    }
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
      return digits;
    }
  } else if (digits.length >= 10 && digits.length <= 13) {
    return digits;
  }

  throw new InvalidPhoneError(raw);
}

const MediaSchema = z.object({
  kind: z.string().min(1),
  url: z.string().url().optional(),
  mimeType: z.string().min(1).optional(),
  fileId: z.string().min(1).optional(),
});

export const NormalizedMessageSchema = z
  .object({
    tenantId: z.string().uuid(),
    channel: z.enum(['whatsapp', 'telegram']),
    externalChannelId: z.string().min(1),
    externalUserId: z.string().min(1),
    externalConversationId: z.string().min(1),
    externalMessageId: z.string().min(1),
    messageType: z.enum(['text', 'audio', 'image', 'document', 'button', 'unsupported']),
    content: z.string().nullable(),
    media: MediaSchema.nullable(),
    receivedAt: z.coerce.date(),
  })
  .superRefine((message, ctx) => {
    if (message.messageType === 'text' && (message.content ?? '').trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content is required for text messages',
      });
    }
  });

export type NormalizedMessage = Omit<z.infer<typeof NormalizedMessageSchema>, 'channel' | 'messageType'> & {
  channel: Channel;
  messageType: MessageType;
};
