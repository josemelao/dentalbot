import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { AppEnv } from '../../config/env';
import { ChannelsRepository } from '../../db/repositories/channels.repository';
import { WebhookEventsRepository } from '../../db/repositories/webhook-events.repository';
import { ENV } from '../../db/tokens';
import { InboundService } from '../../pipeline/inbound.service';
import { mapTelegramUpdate } from './telegram.mapper';
import { verifyTelegramSecret } from './telegram-signature';

const UpdateSchema = z.object({ update_id: z.number().int() }).passthrough();

interface RequestWithCorrelation {
  header(name: string): string | undefined;
  correlationId?: string;
}

@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    private readonly channels: ChannelsRepository,
    private readonly events: WebhookEventsRepository,
    private readonly inbound: InboundService,
  ) {}

  @Post(':externalChannelId')
  @HttpCode(200)
  async handle(
    @Param('externalChannelId') externalChannelId: string,
    @Body() body: unknown,
    @Req() req: RequestWithCorrelation,
  ): Promise<{ ok: boolean; duplicate?: boolean }> {
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ ok: false });
    }

    const providedSecret = req.header('x-telegram-bot-api-secret-token');
    if (!verifyTelegramSecret(providedSecret, this.env.telegramWebhookSecret)) {
      throw new UnauthorizedException({ ok: false });
    }

    const channel = await this.channels.findByExternalId('telegram', externalChannelId);
    if (!channel) {
      throw new NotFoundException({ ok: false });
    }

    const update = parsed.data;
    const event = await this.events.insertOnce({
      tenantId: channel.tenantId,
      channel: 'telegram',
      externalEventId: String(update.update_id),
      externalMessageId: null,
      eventType: 'telegram_update',
      payload: update,
    });

    if (!event.inserted) {
      return { ok: true, duplicate: true };
    }

    const normalized = mapTelegramUpdate(update, {
      tenantId: channel.tenantId,
      externalChannelId,
    });

    if (!normalized) {
      await this.events.markProcessed(channel.tenantId, event.id, 'skipped');
      return { ok: true };
    }

    const result = await this.inbound.handle(
      normalized,
      req.correlationId ?? String(update.update_id),
    );

    await this.events.markProcessed(
      channel.tenantId,
      event.id,
      result.success ? 'processed' : 'failed',
      result.error?.code,
    );

    return { ok: true };
  }
}
