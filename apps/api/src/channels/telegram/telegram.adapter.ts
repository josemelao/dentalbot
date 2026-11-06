import { AppEnv } from '../../config/env';
import { ChannelAdapter, OutboundMessage } from '../channel-adapter';

interface TelegramSendResponse {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class TelegramAdapter implements ChannelAdapter {
  readonly channel = 'telegram' as const;

  constructor(
    private readonly env: AppEnv,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutboundMessage): Promise<{ externalMessageId: string }> {
    if (!this.env.telegramBotToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }

    await this.showTyping(message.externalUserId);
    const delay = Math.min(
      this.env.typingMaxMs,
      this.env.typingMinMs + message.text.length * this.env.typingPerCharMs,
    );
    if (delay > 0) await sleep(delay);

    const response = await this.fetchImpl(
      `${this.env.telegramApiBaseUrl}/bot${this.env.telegramBotToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.externalUserId,
          text: message.text,
        }),
      },
    );

    const body = (await response.json()) as TelegramSendResponse;
    if (!response.ok || !body.ok || !body.result) {
      throw new Error(`Telegram send failed: ${body.description ?? response.status}`);
    }

    return { externalMessageId: String(body.result.message_id) };
  }

  /** Cosmetic: a failure here must never block the message. */
  private async showTyping(chatId: string): Promise<void> {
    try {
      await this.fetchImpl(
        `${this.env.telegramApiBaseUrl}/bot${this.env.telegramBotToken}/sendChatAction`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
        },
      );
    } catch {
      // Ignore: the typing indicator is not part of the delivery guarantee.
    }
  }
}
