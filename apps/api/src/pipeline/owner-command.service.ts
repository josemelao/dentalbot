import { DateTime } from 'luxon';
import { ChannelAdapter } from '../channels/channel-adapter';
import { normalizeText } from '../common/text';
import { AuditRepository } from '../db/repositories/audit.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { HumanTicket } from '../db/repositories/rows';
import { TicketsRepository } from '../db/repositories/tickets.repository';
import { AttendanceService } from '../scheduling/attendance.service';
import { formatAgenda } from './agenda-messages';
import { EscalationService } from './escalation.service';

export const OWNER_MENU =
  '1) Assumir a conversa\n' +
  '2) Encerrar o ticket\n' +
  '3) Responder ao paciente (envie: 3 sua mensagem)\n' +
  '4) Ver agenda\n' +
  'Responda com o número.';

export interface OwnerCommandDependencies {
  tickets: TicketsRepository;
  conversations: ConversationsRepository;
  patients: PatientsRepository;
  messages: MessagesRepository;
  audit: AuditRepository;
  escalation: EscalationService;
  attendance: AttendanceService;
  channel: ChannelAdapter;
  now: () => Date;
}

export interface OwnerCommandInput {
  tenantId: string;
  userId: string;
  externalUserId: string;
  text: string;
  correlationId: string;
}

export interface OwnerCommandResult {
  reply: string;
}

/**
 * The dentist answers the bot, never the patient directly.
 *
 * 1 = assume (bot goes quiet), 2 = resolve (bot resumes), 3 <text> = relay an
 * answer to the patient. Anything else gets the menu instead of guessing.
 */
export class OwnerCommandService {
  constructor(private readonly deps: OwnerCommandDependencies) {}

  async handle(input: OwnerCommandInput): Promise<OwnerCommandResult> {
    const reply = await this.dispatch(input);
    await this.deps.channel.send({ externalUserId: input.externalUserId, text: reply });
    return { reply };
  }

  private async dispatch(input: OwnerCommandInput): Promise<string> {
    const text = input.text.trim();

    if (text === '4' || /^agenda\b/i.test(text)) {
      const when = text === '4' ? '' : text.replace(/^agenda\b/i, '').trim();
      return this.agenda(input.tenantId, when);
    }

    const ticket = await this.deps.tickets.findLatestOpen(input.tenantId);

    if (!ticket) {
      return 'Nenhum ticket aberto no momento.';
    }

    if (text === '1') {
      await this.deps.escalation.accept({
        tenantId: input.tenantId,
        ticket,
        userId: input.userId,
      });
      return (
        'Conversa assumida. O bot fica em silêncio até você enviar 2 (encerrar). ' +
        'Para responder ao paciente, use: 3 sua mensagem'
      );
    }

    if (text === '2') {
      await this.deps.escalation.resolve({ tenantId: input.tenantId, ticket });
      return 'Ticket encerrado. O bot volta a responder o paciente.';
    }

    if (text === '3') {
      return 'Envie: 3 sua mensagem para o paciente.';
    }

    const relay = text.match(/^3[\s:]+([\s\S]+)$/);
    if (relay) {
      const answer = relay[1].trim();
      if (answer.length === 0) {
        return 'Envie: 3 sua mensagem para o paciente.';
      }
      await this.relay(input, ticket, answer);
      return 'Resposta enviada ao paciente.';
    }

    return OWNER_MENU;
  }

  private async agenda(tenantId: string, when: string): Promise<string> {
    const timezone = await this.deps.attendance.timezoneFor(tenantId);
    const dateISO = this.resolveDate(when, timezone);
    if (!dateISO) {
      return 'Não entendi a data. Use: agenda, agenda amanhã ou agenda 09/11.';
    }

    const rows = await this.deps.attendance.listDay(tenantId, dateISO);
    return formatAgenda(rows, dateISO, timezone);
  }

  private resolveDate(raw: string, timezone: string): string | null {
    const now = DateTime.now().setZone(timezone);
    const text = normalizeText(raw);

    if (!text || text === 'hoje') return now.toISODate();
    if (text === 'amanha') return now.plus({ days: 1 }).toISODate();

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

    const short = text.match(/^(\d{1,2})[/.-](\d{1,2})$/);
    if (short) {
      const candidate = now.set({ day: Number(short[1]), month: Number(short[2]) });
      if (!candidate.isValid) return null;
      return (candidate < now.startOf('day') ? candidate.plus({ years: 1 }) : candidate).toISODate();
    }

    const weekdays = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    const weekday = weekdays.find((day) => text.includes(day));
    if (weekday) {
      for (let offset = 0; offset < 8; offset += 1) {
        const candidate = now.plus({ days: offset });
        if (normalizeText(candidate.setLocale('pt-BR').weekdayLong ?? '').startsWith(weekday)) {
          return candidate.toISODate();
        }
      }
    }

    return null;
  }

  private async relay(
    input: OwnerCommandInput,
    ticket: HumanTicket,
    answer: string,
  ): Promise<void> {
    const contact = await this.deps.patients.findContactById(
      input.tenantId,
      ticket.patientContactId,
    );
    if (!contact) {
      throw new Error('Ticket contact not found');
    }

    await this.deps.channel.send({ externalUserId: contact.externalUserId, text: answer });

    await this.deps.messages.appendOutbound({
      tenantId: input.tenantId,
      conversationId: ticket.conversationId,
      channel: contact.channel,
      content: answer,
      deliveryStatus: 'sent',
    });

    await this.deps.conversations.touchOutbound(
      input.tenantId,
      ticket.conversationId,
      this.deps.now(),
    );

    await this.deps.tickets.answer(input.tenantId, ticket.id, answer, input.userId);
    await this.deps.tickets.addEvent({
      tenantId: input.tenantId,
      ticketId: ticket.id,
      event: 'answered',
      actorType: 'human',
      actorId: input.userId,
    });
    await this.deps.audit.append({
      tenantId: input.tenantId,
      actorType: 'human',
      actorId: input.userId,
      action: 'ticket_answered',
      entityType: 'human_ticket',
      entityId: ticket.id,
      correlationId: input.correlationId,
    });
  }
}
