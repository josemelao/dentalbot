import { DynamicModule, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AiGateway } from './ai/ai-gateway';
import { DEFAULT_AI_RULES } from './ai/default-rules';
import { FakeAiGateway } from './ai/fake-ai.gateway';
import { DeterministicFirstGateway } from './ai/deterministic-first.gateway';
import { GeminiClient } from './ai/gemini.client';
import { LlmIntentGateway } from './ai/llm-intent.gateway';
import { OpenAiClient } from './ai/openai.client';
import { UnknownRouter } from './ai/unknown-router';
import { AI_GATEWAY, UNKNOWN_ROUTER } from './ai/tokens';
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
import { configureMessageStyle } from './common/message-style';
import { createPool } from './db/pool';
import { AiInvocationsRepository } from './db/repositories/ai-invocations.repository';
import { AppointmentsRepository } from './db/repositories/appointments.repository';
import { AuditRepository } from './db/repositories/audit.repository';
import { CatalogRepository } from './db/repositories/catalog.repository';
import { ChannelsRepository } from './db/repositories/channels.repository';
import { ClinicUsersRepository } from './db/repositories/clinic-users.repository';
import { ConversationsRepository } from './db/repositories/conversations.repository';
import { KnowledgeRepository } from './db/repositories/knowledge.repository';
import { LocksRepository } from './db/repositories/locks.repository';
import { MessagesRepository } from './db/repositories/messages.repository';
import { OperationsRepository } from './db/repositories/operations.repository';
import { PatientsRepository } from './db/repositories/patients.repository';
import { RemindersRepository } from './db/repositories/reminders.repository';
import { TicketsRepository } from './db/repositories/tickets.repository';
import { WebhookEventsRepository } from './db/repositories/webhook-events.repository';
import { DB_POOL, ENV } from './db/tokens';
import { HealthController } from './health/health.controller';
import { PanelController } from './panel/panel.controller';
import { PanelAuthService } from './panel/panel-auth.service';
import { PanelService } from './panel/panel.service';
import { AvailabilityService } from './scheduling/availability.service';
import { AttendanceService } from './scheduling/attendance.service';
import { BookingService } from './scheduling/booking.service';
import { SchedulingFlowService } from './scheduling/scheduling-flow.service';
import { SlotEngine } from './scheduling/slot-engine';
import { ReminderService } from './scheduling/reminder.service';
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
    configureMessageStyle({ emoji: options.env.messageEmoji });

    const llmClient =
      options.env.aiProvider === 'gemini' && options.env.geminiApiKey
        ? new GeminiClient(options.env.geminiApiKey, options.env.geminiModel)
        : options.env.aiProvider === 'openai' && options.env.openaiApiKey
          ? new OpenAiClient(options.env.openaiApiKey, options.env.openaiModel)
          : null;

    const aiGateway =
      options.aiGateway ??
      (llmClient
        ? new DeterministicFirstGateway(new LlmIntentGateway(llmClient))
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
      controllers: [HealthController, PanelController, TelegramWebhookController],
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
            messages: MessagesRepository,
            audit: AuditRepository,
            notifierService: OwnerNotifier,
            channel: ChannelAdapter,
          ) =>
            new EscalationService({
              tickets,
              channels,
              conversations,
              patients,
              messages,
              audit,
              notifier: notifierService,
              ownerChannel: 'telegram',
              channel,
              slaMinutes: options.env.slaMinutes,
            }),
          inject: [
            TicketsRepository,
            ChannelsRepository,
            ConversationsRepository,
            PatientsRepository,
            MessagesRepository,
            AuditRepository,
            OWNER_NOTIFIER,
            CHANNEL_ADAPTER,
          ],
        },
        {
          provide: RemindersRepository,
          useFactory: (pool: Pool) => new RemindersRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: ReminderService,
          useFactory: (
            appointments: AppointmentsRepository,
            reminders: RemindersRepository,
            patients: PatientsRepository,
            catalog: CatalogRepository,
            messages: MessagesRepository,
            conversations: ConversationsRepository,
            audit: AuditRepository,
            channel: ChannelAdapter,
          ) =>
            new ReminderService({
              appointments,
              reminders,
              patients,
              catalog,
              messages,
              conversations,
              audit,
              channel,
              now: () => new Date(),
              minLeadHours: options.env.reminderMinLeadHours,
              maxLeadHours: options.env.reminderMaxLeadHours,
            }),
          inject: [
            AppointmentsRepository,
            RemindersRepository,
            PatientsRepository,
            CatalogRepository,
            MessagesRepository,
            ConversationsRepository,
            AuditRepository,
            CHANNEL_ADAPTER,
          ],
        },
        {
          provide: AttendanceService,
          useFactory: (
            appointments: AppointmentsRepository,
            catalog: CatalogRepository,
            patients: PatientsRepository,
            audit: AuditRepository,
          ) =>
            new AttendanceService({
              appointments,
              catalog,
              patients,
              audit,
              now: () => new Date(),
            }),
          inject: [
            AppointmentsRepository,
            CatalogRepository,
            PatientsRepository,
            AuditRepository,
          ],
        },
        {
          provide: ClinicUsersRepository,
          useFactory: (pool: Pool) => new ClinicUsersRepository(pool),
          inject: [DB_POOL],
        },
        {
          provide: PanelAuthService,
          useFactory: (users: ClinicUsersRepository) =>
            new PanelAuthService({
              users,
              secret: options.env.sessionSecret,
              now: () => new Date(),
            }),
          inject: [ClinicUsersRepository],
        },
        {
          provide: PanelService,
          useFactory: (
            pool: Pool,
            attendance: AttendanceService,
            tickets: TicketsRepository,
            knowledge: KnowledgeRepository,
            catalog: CatalogRepository,
            messages: MessagesRepository,
            conversations: ConversationsRepository,
            patients: PatientsRepository,
          ) =>
            new PanelService({
              pool,
              attendance,
              tickets,
              knowledge,
              catalog,
              messages,
              conversations,
              patients,
            }),
          inject: [
            DB_POOL,
            AttendanceService,
            TicketsRepository,
            KnowledgeRepository,
            CatalogRepository,
            MessagesRepository,
            ConversationsRepository,
            PatientsRepository,
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
            attendance: AttendanceService,
            channel: ChannelAdapter,
          ) =>
            new OwnerCommandService({
              tickets,
              conversations,
              patients,
              messages,
              audit,
              escalation,
              attendance,
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
            AttendanceService,
            CHANNEL_ADAPTER,
          ],
        },
        {
          provide: UNKNOWN_ROUTER,
          useFactory: (knowledge: KnowledgeRepository) =>
            llmClient
              ? new UnknownRouter({
                  client: llmClient,
                  knowledge,
                  confidenceThreshold: options.env.routerConfidenceThreshold,
                  now: () => new Date(),
                })
              : null,
          inject: [KnowledgeRepository],
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
            router: UnknownRouter | null,
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
              router,
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
            UNKNOWN_ROUTER,
          ],
        },
      ],
    };
  }
}
