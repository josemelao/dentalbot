import { DynamicModule, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AiGateway } from './ai/ai-gateway';
import { DEFAULT_AI_RULES } from './ai/default-rules';
import { FakeAiGateway } from './ai/fake-ai.gateway';
import { DeterministicFirstGateway } from './ai/deterministic-first.gateway';
import { OpenAiIntentGateway } from './ai/openai-intent.gateway';
import { AI_GATEWAY } from './ai/tokens';
import { ChannelAdapter } from './channels/channel-adapter';
import { FakeChannelAdapter } from './channels/fake/fake-channel.adapter';
import { OwnerNotifier, ChannelOwnerNotifier, NoopOwnerNotifier } from './channels/owner-notifier';
import { CHANNEL_ADAPTER, OWNER_NOTIFIER } from './channels/tokens';
import { TelegramAdapter } from './channels/telegram/telegram.adapter';
import { TelegramWebhookController } from './channels/telegram/telegram.webhook.controller';
import { CalendarAdapter } from './calendar/calendar-adapter';
import { FakeCalendarAdapter } from './calendar/fake-calendar.adapter';
import { CALENDAR_ADAPTER } from './calendar/tokens';
import { AppEnv } from './config/env';
import { createPool } from './db/pool';
import { AiInvocationsRepository } from './db/repositories/ai-invocations.repository';
import { AppointmentsRepository } from './db/repositories/appointments.repository';
import { AuditRepository } from './db/repositories/audit.repository';
import { CatalogRepository } from './db/repositories/catalog.repository';
import { ChannelsRepository } from './db/repositories/channels.repository';
import { ConversationsRepository } from './db/repositories/conversations.repository';
import { KnowledgeRepository } from './db/repositories/knowledge.repository';
import { LocksRepository } from './db/repositories/locks.repository';
import { MessagesRepository } from './db/repositories/messages.repository';
import { OperationsRepository } from './db/repositories/operations.repository';
import { PatientsRepository } from './db/repositories/patients.repository';
import { TicketsRepository } from './db/repositories/tickets.repository';
import { WebhookEventsRepository } from './db/repositories/webhook-events.repository';
import { DB_POOL, ENV } from './db/tokens';
import { HealthController } from './health/health.controller';
import { AvailabilityService } from './scheduling/availability.service';
import { BookingService } from './scheduling/booking.service';
import { SchedulingFlowService } from './scheduling/scheduling-flow.service';
import { SlotEngine } from './scheduling/slot-engine';
import { ResponseComposer } from './pipeline/composer.service';
import { EscalationService } from './pipeline/escalation.service';
import { OwnerCommandService } from './pipeline/owner-command.service';
import { FaqService } from './pipeline/faq.service';
import { IdentityService } from './pipeline/identity.service';
import { InboundService } from './pipeline/inbound.service';
import { IntentService } from './pipeline/intent.service';
import { SafetyService } from './pipeline/safety.service';

export interface AppModuleOptions {
  env: AppEnv;
  pool?: Pool;
  channelAdapter?: ChannelAdapter;
  calendarAdapter?: CalendarAdapter;
  aiGateway?: AiGateway;
  notifier?: OwnerNotifier;
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    const aiGateway =
      options.aiGateway ??
      (options.env.aiProvider === 'openai' && options.env.openaiApiKey
        ? new DeterministicFirstGateway(new OpenAiIntentGateway(options.env.openaiApiKey))
        : new FakeAiGateway(DEFAULT_AI_RULES));
    const channelAdapter =
      options.channelAdapter ??
      (options.env.channelTransport === 'fake'
        ? new FakeChannelAdapter()
        : new TelegramAdapter(options.env));
    const notifier =
      options.notifier ??
      (options.env.channelTransport === 'fake'
        ? new NoopOwnerNotifier()
        : new ChannelOwnerNotifier(channelAdapter));
    const calendarAdapter =
      options.calendarAdapter ??
      (options.env.nodeEnv === 'production' ? null : new FakeCalendarAdapter());
    if (!calendarAdapter) {
      throw new Error(
        'Calendar adapter is not configured for production; refusing to use the fake adapter',
      );
    }

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
          useValue: channelAdapter,
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
        {
          provide: CALENDAR_ADAPTER,
          useValue: calendarAdapter,
        },
        {
          provide: CatalogRepository,
          useFactory: (pool: Pool) => new CatalogRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: AppointmentsRepository,
          useFactory: (pool: Pool) => new AppointmentsRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: OperationsRepository,
          useFactory: (pool: Pool) => new OperationsRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: LocksRepository,
          useFactory: (pool: Pool) => new LocksRepository(pool),
          inject: [DB_POOL],
        },
        SlotEngine,
        {
          provide: AvailabilityService,
          useFactory: (catalog: CatalogRepository, engine: SlotEngine) =>
            new AvailabilityService(catalog, engine, {
              granularityMinutes: 15,
              minAdvanceMinutes: 120,
              maxHorizonDays: 90,
            }),
          inject: [CatalogRepository, SlotEngine],
        },
        {
          provide: BookingService,
          useFactory: (
            catalog: CatalogRepository,
            availability: AvailabilityService,
            appointments: AppointmentsRepository,
            operations: OperationsRepository,
            locks: LocksRepository,
            calendar: CalendarAdapter,
          ) =>
            new BookingService({
              catalog,
              availability,
              appointments,
              operations,
              locks,
              calendar,
              now: () => new Date(),
            }),
          inject: [
            CatalogRepository,
            AvailabilityService,
            AppointmentsRepository,
            OperationsRepository,
            LocksRepository,
            CALENDAR_ADAPTER,
          ],
        },
        {
          provide: SchedulingFlowService,
          useFactory: (
            catalog: CatalogRepository,
            availability: AvailabilityService,
            appointments: AppointmentsRepository,
            patients: PatientsRepository,
            booking: BookingService,
          ) =>
            new SchedulingFlowService({
              catalog,
              availability,
              appointments,
              patients,
              booking,
              now: () => new Date(),
              horizonDays: 7,
            }),
          inject: [
            CatalogRepository,
            AvailabilityService,
            AppointmentsRepository,
            PatientsRepository,
            BookingService,
          ],
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
            patients: PatientsRepository,
            audit: AuditRepository,
            notifierService: OwnerNotifier,
          ) =>
            new EscalationService({
              tickets,
              channels,
              conversations,
              patients,
              audit,
              notifier: notifierService,
              ownerChannel: 'telegram',
              slaMinutes: options.env.slaMinutes,
            }),
          inject: [
            TicketsRepository,
            ChannelsRepository,
            ConversationsRepository,
            PatientsRepository,
            AuditRepository,
            OWNER_NOTIFIER,
          ],
        },
        {
          provide: OwnerCommandService,
          useFactory: (
            tickets: TicketsRepository,
            conversations: ConversationsRepository,
            patients: PatientsRepository,
            messages: MessagesRepository,
            audit: AuditRepository,
            escalation: EscalationService,
            channel: ChannelAdapter,
          ) =>
            new OwnerCommandService({
              tickets,
              conversations,
              patients,
              messages,
              audit,
              escalation,
              channel,
              now: () => new Date(),
            }),
          inject: [
            TicketsRepository,
            ConversationsRepository,
            PatientsRepository,
            MessagesRepository,
            AuditRepository,
            EscalationService,
            CHANNEL_ADAPTER,
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
            schedulingFlow: SchedulingFlowService,
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
              schedulingFlow,
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
            SchedulingFlowService,
            CHANNEL_ADAPTER,
          ],
        },
      ],
    };
  }
}
