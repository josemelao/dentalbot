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
import { OwnerCommandService } from '../../pipeline/owner-command.service';
import { mapTelegramUpdate } from './telegram.mapper';
import { verifyTelegramSecret } from './telegram-signature';

const TelegramMessageSchema = z
  .object({
    message_id: z.number().int(),
    date: z.number().int(),
    chat: z.object({ id: z.number().int() }).passthrough(),
    from: z.object({ id: z.number().int() }).passthrough().optional(),
    text: z.string().optional(),
    voice: z.unknown().optional(),
    audio: z.unknown().optional(),
    photo: z.unknown().optional(),
    document: z.unknown().optional(),
  })
  .passthrough();

const UpdateSchema = z
  .object({
    update_id: z.number().int(),
    message: TelegramMessageSchema.optional(),
  })
  .passthrough();

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
    private readonly ownerCommands: OwnerCommandService,
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
      const status = await this.events.findStatus(channel.tenantId, event.id);
      if (status === 'processed' || status === 'skipped') {
        return { ok: true, duplicate: true };
      }
      // A received or failed event is a retry: fall through and process it.
    }

    const normalized = mapTelegramUpdate(update, {
      tenantId: channel.tenantId,
      externalChannelId,
    });

    if (!normalized) {
      await this.events.markProcessed(channel.tenantId, event.id, 'skipped');
      return { ok: true };
    }

    const correlationId = req.correlationId ?? String(update.update_id);

    // A linked staff id is never treated as a patient: it is a ticket command.
    const owner = await this.channels.findOwnerByExternalId(
      'telegram',
      normalized.externalUserId,
    );
    if (owner && owner.tenantId === channel.tenantId) {
      await this.ownerCommands.handle({
        tenantId: channel.tenantId,
        userId: owner.userId,
        externalUserId: normalized.externalUserId,
        text: normalized.content ?? '',
        correlationId,
      });
      await this.events.markProcessed(channel.tenantId, event.id, 'processed');
      return { ok: true };
    }

    const result = await this.inbound.handle(normalized, correlationId);

    await this.events.markProcessed(
      channel.tenantId,
      event.id,
      result.success ? 'processed' : 'failed',
      result.error?.code,
    );

    return { ok: true };
  }
}
