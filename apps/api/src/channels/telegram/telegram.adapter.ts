import { AppEnv } from '../../config/env';
import { ChannelAdapter, OutboundMessage } from '../channel-adapter';

interface TelegramSendResponse {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

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
}
