import { DynamicModule, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AiGateway } from './ai/ai-gateway';
import { DEFAULT_AI_RULES } from './ai/default-rules';
import { FakeAiGateway } from './ai/fake-ai.gateway';
import { OpenAiIntentGateway } from './ai/openai-intent.gateway';
import { AI_GATEWAY } from './ai/tokens';
import { ChannelAdapter } from './channels/channel-adapter';
import { FakeChannelAdapter } from './channels/fake/fake-channel.adapter';
import { OwnerNotifier, RecordingOwnerNotifier } from './channels/owner-notifier';
import { CHANNEL_ADAPTER, OWNER_NOTIFIER } from './channels/tokens';
import { TelegramAdapter } from './channels/telegram/telegram.adapter';
import { TelegramWebhookController } from './channels/telegram/telegram.webhook.controller';
import { AppEnv } from './config/env';
import { createPool } from './db/pool';
import { AiInvocationsRepository } from './db/repositories/ai-invocations.repository';
import { AuditRepository } from './db/repositories/audit.repository';
import { ChannelsRepository } from './db/repositories/channels.repository';
import { ConversationsRepository } from './db/repositories/conversations.repository';
import { KnowledgeRepository } from './db/repositories/knowledge.repository';
import { MessagesRepository } from './db/repositories/messages.repository';
import { PatientsRepository } from './db/repositories/patients.repository';
import { TicketsRepository } from './db/repositories/tickets.repository';
import { WebhookEventsRepository } from './db/repositories/webhook-events.repository';
import { DB_POOL, ENV } from './db/tokens';
import { HealthController } from './health/health.controller';
import { ResponseComposer } from './pipeline/composer.service';
import { EscalationService } from './pipeline/escalation.service';
import { FaqService } from './pipeline/faq.service';
import { IdentityService } from './pipeline/identity.service';
import { InboundService } from './pipeline/inbound.service';
import { IntentService } from './pipeline/intent.service';
import { SafetyService } from './pipeline/safety.service';

export interface AppModuleOptions {
  env: AppEnv;
  pool?: Pool;
  channelAdapter?: ChannelAdapter;
  aiGateway?: AiGateway;
  notifier?: OwnerNotifier;
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    const aiGateway =
      options.aiGateway ??
      (options.env.aiProvider === 'openai' && options.env.openaiApiKey
        ? new OpenAiIntentGateway(options.env.openaiApiKey)
        : new FakeAiGateway(DEFAULT_AI_RULES));
    const notifier = options.notifier ?? new RecordingOwnerNotifier();

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
          useValue:
            options.channelAdapter ??
            (options.env.channelTransport === 'fake'
              ? new FakeChannelAdapter()
              : new TelegramAdapter(options.env)),
        },
        { provide: AI_GATEWAY, useValue: aiGateway },
        { provide: OWNER_NOTIFIER, useValue: notifier },
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
          provide: AiInvocationsRepository,
          useFactory: (pool: Pool) => new AiInvocationsRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: KnowledgeRepository,
          useFactory: (pool: Pool) => new KnowledgeRepository(pool),
          inject: [DB_POOL],
        },
        SafetyService,
        ResponseComposer,
        {
          provide: IdentityService,
          useFactory: (
            channels: ChannelsRepository,
            patients: PatientsRepository,
            conversations: ConversationsRepository,
            messages: MessagesRepository,
          ) => new IdentityService({ channels, patients, conversations, messages }),
          inject: [
            ChannelsRepository,
            PatientsRepository,
            ConversationsRepository,
            MessagesRepository,
          ],
        },
        {
          provide: IntentService,
          useFactory: (ai: AiGateway, pool: Pool) => new IntentService(ai, pool),
          inject: [AI_GATEWAY, DB_POOL],
        },
        {
          provide: FaqService,
          useFactory: (knowledge: KnowledgeRepository) => new FaqService(knowledge),
          inject: [KnowledgeRepository],
        },
        {
          provide: EscalationService,
          useFactory: (
            tickets: TicketsRepository,
            channels: ChannelsRepository,
            conversations: ConversationsRepository,
            audit: AuditRepository,
            notifierService: OwnerNotifier,
          ) =>
            new EscalationService({
              tickets,
              channels,
              conversations,
              audit,
              notifier: notifierService,
              slaMinutes: options.env.slaMinutes,
            }),
          inject: [
            TicketsRepository,
            ChannelsRepository,
            ConversationsRepository,
            AuditRepository,
            OWNER_NOTIFIER,
          ],
        },
        {
          provide: InboundService,
          useFactory: (
            identity: IdentityService,
            conversations: ConversationsRepository,
            messages: MessagesRepository,
            tickets: TicketsRepository,
            audit: AuditRepository,
            safety: SafetyService,
            intent: IntentService,
            faq: FaqService,
            escalation: EscalationService,
            composer: ResponseComposer,
            channel: ChannelAdapter,
          ) =>
            new InboundService({
              identity,
              conversations,
              messages,
              tickets,
              audit,
              safety,
              intent,
              faq,
              escalation,
              composer,
              channel,
              slaMinutes: options.env.slaMinutes,
            }),
          inject: [
            IdentityService,
            ConversationsRepository,
            MessagesRepository,
            TicketsRepository,
            AuditRepository,
            SafetyService,
            IntentService,
            FaqService,
            EscalationService,
            ResponseComposer,
            CHANNEL_ADAPTER,
          ],
        },
      ],
    };
  }
}
