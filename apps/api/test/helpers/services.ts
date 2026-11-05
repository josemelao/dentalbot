import { Pool } from 'pg';
import { DEFAULT_AI_RULES } from '../../src/ai/default-rules';
import { FakeAiGateway } from '../../src/ai/fake-ai.gateway';
import { FakeChannelAdapter } from '../../src/channels/fake/fake-channel.adapter';
import { RecordingOwnerNotifier } from '../../src/channels/owner-notifier';
import { AuditRepository } from '../../src/db/repositories/audit.repository';
import { ChannelsRepository } from '../../src/db/repositories/channels.repository';
import { ConversationsRepository } from '../../src/db/repositories/conversations.repository';
import { KnowledgeRepository } from '../../src/db/repositories/knowledge.repository';
import { MessagesRepository } from '../../src/db/repositories/messages.repository';
import { PatientsRepository } from '../../src/db/repositories/patients.repository';
import { TicketsRepository } from '../../src/db/repositories/tickets.repository';
import { ResponseComposer } from '../../src/pipeline/composer.service';
import { EscalationService } from '../../src/pipeline/escalation.service';
import { FaqService } from '../../src/pipeline/faq.service';
import { IdentityService } from '../../src/pipeline/identity.service';
import { InboundService } from '../../src/pipeline/inbound.service';
import { IntentService } from '../../src/pipeline/intent.service';
import { SafetyService } from '../../src/pipeline/safety.service';

export function buildInboundService(pool: Pool): InboundService {
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
  const escalation = new EscalationService({
    tickets,
    channels,
    conversations,
    audit,
    notifier,
    slaMinutes: 15,
  });
  const composer = new ResponseComposer();
  const channel = new FakeChannelAdapter();

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
    channel,
    slaMinutes: 15,
  });
}
