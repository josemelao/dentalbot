import { DynamicModule, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ChannelAdapter } from './channels/channel-adapter';
import { CHANNEL_ADAPTER } from './channels/tokens';
import { TelegramAdapter } from './channels/telegram/telegram.adapter';
import { TelegramWebhookController } from './channels/telegram/telegram.webhook.controller';
import { AppEnv } from './config/env';
import { createPool } from './db/pool';
import { AuditRepository } from './db/repositories/audit.repository';
import { ChannelsRepository } from './db/repositories/channels.repository';
import { ConversationsRepository } from './db/repositories/conversations.repository';
import { MessagesRepository } from './db/repositories/messages.repository';
import { PatientsRepository } from './db/repositories/patients.repository';
import { TicketsRepository } from './db/repositories/tickets.repository';
import { WebhookEventsRepository } from './db/repositories/webhook-events.repository';
import { DB_POOL, ENV } from './db/tokens';
import { HealthController } from './health/health.controller';
import { IdentityService } from './pipeline/identity.service';
import { InboundService } from './pipeline/inbound.service';

export interface AppModuleOptions {
  env: AppEnv;
  pool?: Pool;
  channelAdapter?: ChannelAdapter;
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, TelegramWebhookController],
      providers: [
        { provide: ENV, useValue: options.env },
        {
          provide: DB_POOL,
          useValue: options.pool ?? createPool(options.env.databaseUrl),
        },
        {
          provide: CHANNEL_ADAPTER,
          useValue: options.channelAdapter ?? new TelegramAdapter(options.env),
        },
        {
          provide: ChannelsRepository,
          useFactory: (pool: Pool) => new ChannelsRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: PatientsRepository,
          useFactory: (pool: Pool) => new PatientsRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: ConversationsRepository,
          useFactory: (pool: Pool) => new ConversationsRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: MessagesRepository,
          useFactory: (pool: Pool) => new MessagesRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: TicketsRepository,
          useFactory: (pool: Pool) => new TicketsRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: WebhookEventsRepository,
          useFactory: (pool: Pool) => new WebhookEventsRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: AuditRepository,
          useFactory: (pool: Pool) => new AuditRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: IdentityService,
          useFactory: (
            channels: ChannelsRepository,
            patients: PatientsRepository,
            conversations: ConversationsRepository,
            messages: MessagesRepository,
          ) => new IdentityService({ channels, patients, conversations, messages }),
          inject: [ChannelsRepository, PatientsRepository, ConversationsRepository, MessagesRepository],
        },
        {
          provide: InboundService,
          useFactory: (
            identity: IdentityService,
            conversations: ConversationsRepository,
            messages: MessagesRepository,
            tickets: TicketsRepository,
            audit: AuditRepository,
          ) => new InboundService({ identity, conversations, messages, tickets, audit }),
          inject: [
            IdentityService,
            ConversationsRepository,
            MessagesRepository,
            TicketsRepository,
            AuditRepository,
          ],
        },
      ],
    };
  }
}
