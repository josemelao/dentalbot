import { Pool } from 'pg';
import { DEFAULT_AI_RULES } from '../../src/ai/default-rules';
import { FakeAiGateway } from '../../src/ai/fake-ai.gateway';
import { UnknownRouter } from '../../src/ai/unknown-router';
import { FakeChannelAdapter } from '../../src/channels/fake/fake-channel.adapter';
import { RecordingOwnerNotifier } from '../../src/channels/owner-notifier';
import { AuditRepository } from '../../src/db/repositories/audit.repository';
import { AppointmentsRepository } from '../../src/db/repositories/appointments.repository';
import { ChannelsRepository } from '../../src/db/repositories/channels.repository';
import { ConversationsRepository } from '../../src/db/repositories/conversations.repository';
import { KnowledgeRepository } from '../../src/db/repositories/knowledge.repository';
import { MessagesRepository } from '../../src/db/repositories/messages.repository';
import { PatientsRepository } from '../../src/db/repositories/patients.repository';
import { TicketsRepository } from '../../src/db/repositories/tickets.repository';
import { OperationsRepository } from '../../src/db/repositories/operations.repository';
import { LocksRepository } from '../../src/db/repositories/locks.repository';
import { CatalogRepository } from '../../src/db/repositories/catalog.repository';
import { FakeCalendarAdapter } from '../../src/calendar/fake-calendar.adapter';
import { AvailabilityService } from '../../src/scheduling/availability.service';
import { SlotEngine } from '../../src/scheduling/slot-engine';
import { BookingService } from '../../src/scheduling/booking.service';
import { RescheduleProposalService } from '../../src/scheduling/reschedule-proposal.service';
import { RescheduleProposalRepository } from '../../src/db/repositories/reschedule-proposals.repository';
import { PendingRepliesRepository } from '../../src/db/repositories/pending-replies.repository';
import { PendingReplyService, ShadowModeService } from '../../src/pipeline/pending-reply.service';
import { SchedulingFlowService } from '../../src/scheduling/scheduling-flow.service';
import { ResponseComposer } from '../../src/pipeline/composer.service';
import { EscalationService } from '../../src/pipeline/escalation.service';
import { FaqService } from '../../src/pipeline/faq.service';
import { IdentityService } from '../../src/pipeline/identity.service';
import { InboundService } from '../../src/pipeline/inbound.service';
import { IntentService } from '../../src/pipeline/intent.service';
import { SafetyService } from '../../src/pipeline/safety.service';

export function buildInboundService(
  pool: Pool,
  options: { router?: UnknownRouter | null } = {},
): InboundService {
  const channels = new ChannelsRepository(pool);
  const patients = new PatientsRepository(pool);
  const conversations = new ConversationsRepository(pool);
  const messages = new MessagesRepository(pool);
  const tickets = new TicketsRepository(pool);
  const audit = new AuditRepository(pool);

  const identity = new IdentityService({ channels, patients, conversations, messages });
  const intent = new IntentService(new FakeAiGateway(DEFAULT_AI_RULES), pool);
  const safety = new SafetyService();
  const faq = new FaqService(new KnowledgeRepository(pool));
  const notifier = new RecordingOwnerNotifier();
  const channel = new FakeChannelAdapter();
  const escalation = new EscalationService({
    tickets,
    channels,
    conversations,
    patients,
    messages,
    audit,
    notifier,
    ownerChannel: 'telegram',
    channel,
    slaMinutes: 15,
  });
  const composer = new ResponseComposer();

  const catalog = new CatalogRepository(pool);
  const availability = new AvailabilityService(catalog, new SlotEngine(), {
    granularityMinutes: 15,
    minAdvanceMinutes: 0,
    maxHorizonDays: 90,
  });
  const appointments = new AppointmentsRepository(pool);
  const operations = new OperationsRepository(pool);
  const locks = new LocksRepository(pool);
  const booking = new BookingService({
    catalog,
    availability,
    appointments,
    operations,
    locks,
    calendar: new FakeCalendarAdapter(),
    now: () => new Date(),
  });
  const schedulingFlow = new SchedulingFlowService({
    catalog,
    availability,
    appointments,
    patients,
    booking,
    now: () => new Date(),
    horizonDays: 7,
  });

  const rescheduleProposal = new RescheduleProposalService({
    proposals: new RescheduleProposalRepository(pool),
    appointments,
    catalog,
    availability,
    booking,
    patients,
    messages,
    conversations,
    channel,
    now: () => new Date(),
    ttlHours: 24,
    horizonDays: 30,
  });

  const shadow = new ShadowModeService(pool);
  const pendingReplies = new PendingReplyService({
    pending: new PendingRepliesRepository(pool),
    messages,
    conversations,
    patients,
    channel,
  });

  return new InboundService({
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
    rescheduleProposal,
    shadow,
    pendingReplies,
    router: options.router ?? null,
    channel,
    slaMinutes: 15,
  });
}
