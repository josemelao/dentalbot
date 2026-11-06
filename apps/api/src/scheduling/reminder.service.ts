import { ChannelAdapter } from '../channels/channel-adapter';
import { AuditRepository } from '../db/repositories/audit.repository';
import { AppointmentsRepository } from '../db/repositories/appointments.repository';
import { CatalogRepository } from '../db/repositories/catalog.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { RemindersRepository } from '../db/repositories/reminders.repository';

export interface ReminderDependencies {
  appointments: AppointmentsRepository;
  reminders: RemindersRepository;
  patients: PatientsRepository;
  catalog: CatalogRepository;
  messages: MessagesRepository;
  conversations: ConversationsRepository;
  audit: AuditRepository;
  channel: ChannelAdapter;
  now: () => Date;
  minLeadHours: number;
  maxLeadHours: number;
}

export interface ReminderSweepResult {
  tenantId: string;
  eligible: number;
  sent: number;
  failed: number;
  skipped: number;
}

export function formatReminder(
  serviceName: string,
  startAt: Date,
  timezone: string,
): string {
  const when = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(startAt);

  return (
    `Lembrete: ${serviceName} em ${when}. ` +
    'Responda SIM para confirmar ou CANCELAR para desmarcar.'
  );
}

/**
 * Sends the 24h reminder and records it.
 *
 * Eligibility is a time window, not a fixed hour: a 09:15 appointment is
 * reminded around 09:15 the day before. The window is wide enough to survive a
 * few hours of downtime and narrow enough to never remind twice.
 */
export class ReminderService {
  constructor(private readonly deps: ReminderDependencies) {}

  async sweepTenant(tenantId: string): Promise<ReminderSweepResult> {
    const now = this.deps.now();
    const from = new Date(now.getTime() + this.deps.minLeadHours * 3_600_000);
    const to = new Date(now.getTime() + this.deps.maxLeadHours * 3_600_000);

    const due = await this.deps.appointments.listNeedingReminder(
      tenantId,
      '24H',
      from,
      to,
    );
    const locations = await this.deps.catalog.listActiveLocations(tenantId);

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const appointment of due) {
      const contact = await this.deps.patients.findContactById(
        tenantId,
        appointment.patientContactId,
      );
      if (!contact || contact.optInStatus === 'opted_out') {
        skipped += 1;
        continue;
      }

      const claim = await this.deps.reminders.claim({
        tenantId,
        appointmentId: appointment.id,
        kind: '24H',
        channel: contact.channel,
      });
      if (!claim) {
        skipped += 1;
        continue;
      }

      try {
        const service = await this.deps.catalog.findService(
          tenantId,
          appointment.serviceId,
        );
        const location = locations.find((item) => item.id === appointment.locationId);
        const timezone = location?.timezone ?? 'America/Sao_Paulo';
        const text = formatReminder(
          service?.name ?? 'sua consulta',
          appointment.startAt,
          timezone,
        );

        const { externalMessageId } = await this.deps.channel.send({
          externalUserId: contact.externalUserId,
          text,
        });

        await this.deps.reminders.markSent(tenantId, claim, externalMessageId);

        const conversationId = await this.findConversationId(
          tenantId,
          appointment.patientContactId,
        );
        if (conversationId) {
          await this.deps.messages.appendOutbound({
            tenantId,
            conversationId,
            channel: contact.channel,
            content: text,
            deliveryStatus: 'sent',
          });
          await this.deps.conversations.touchOutbound(tenantId, conversationId, now);
        }

        await this.deps.audit.append({
          tenantId,
          actorType: 'bot',
          action: 'reminder_sent',
          entityType: 'appointment',
          entityId: appointment.id,
          metadata: { kind: '24H' },
        });

        sent += 1;
      } catch {
        await this.deps.reminders.release(tenantId, claim);
        failed += 1;
      }
    }

    return { tenantId, eligible: due.length, sent, failed, skipped };
  }

  private async findConversationId(
    tenantId: string,
    contactId: string,
  ): Promise<string | null> {
    const conversation = await this.deps.conversations.findOpenByContact(
      tenantId,
      contactId,
    );
    return conversation?.id ?? null;
  }
}
