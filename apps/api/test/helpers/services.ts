import { Pool } from 'pg';
import { AuditRepository } from '../../src/db/repositories/audit.repository';
import { ChannelsRepository } from '../../src/db/repositories/channels.repository';
import { ConversationsRepository } from '../../src/db/repositories/conversations.repository';
import { MessagesRepository } from '../../src/db/repositories/messages.repository';
import { PatientsRepository } from '../../src/db/repositories/patients.repository';
import { TicketsRepository } from '../../src/db/repositories/tickets.repository';
import { IdentityService } from '../../src/pipeline/identity.service';
import { InboundService } from '../../src/pipeline/inbound.service';

export function buildInboundService(pool: Pool): InboundService {
  const channels = new ChannelsRepository(pool);
  const patients = new PatientsRepository(pool);
  const conversations = new ConversationsRepository(pool);
  const messages = new MessagesRepository(pool);
  const tickets = new TicketsRepository(pool);
  const audit = new AuditRepository(pool);

  const identity = new IdentityService({ channels, patients, conversations, messages });

  return new InboundService({ identity, conversations, messages, tickets, audit });
}
