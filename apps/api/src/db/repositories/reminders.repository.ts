import { Channel } from '../../contracts/channel';
import { Queryable } from '../pool';

export type ReminderKind = '24H' | '48H';

export interface ClaimReminderInput {
  tenantId: string;
  appointmentId: string;
  kind: ReminderKind;
  channel: Channel;
}

export class RemindersRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Reserves the reminder before sending. Returns null when another run already
   * owns it, which is what makes the job safe to run more than once.
   */
  async claim(input: ClaimReminderInput): Promise<string | null> {
    const { rows } = await this.db.query(
      `insert into appointment_reminders (tenant_id, appointment_id, kind, channel)
       values ($1, $2, $3, $4)
       on conflict (appointment_id, kind) do nothing
       returning id`,
      [input.tenantId, input.appointmentId, input.kind, input.channel],
    );
    return (rows[0] as { id: string } | undefined)?.id ?? null;
  }

  async markSent(
    tenantId: string,
    reminderId: string,
    externalMessageId: string | null,
  ): Promise<void> {
    await this.db.query(
      `update appointment_reminders
       set sent_at = now(), external_message_id = $3
       where tenant_id = $1 and id = $2`,
      [tenantId, reminderId, externalMessageId],
    );
  }

  /** Frees the claim after a failed send so the next run can retry. */
  async release(tenantId: string, reminderId: string): Promise<void> {
    await this.db.query(
      `delete from appointment_reminders where tenant_id = $1 and id = $2`,
      [tenantId, reminderId],
    );
  }

  async findSent(
    tenantId: string,
    appointmentId: string,
    kind: ReminderKind,
  ): Promise<{ sentAt: Date | null } | null> {
    const { rows } = await this.db.query(
      `select sent_at as "sentAt" from appointment_reminders
       where tenant_id = $1 and appointment_id = $2 and kind = $3`,
      [tenantId, appointmentId, kind],
    );
    return (rows[0] as { sentAt: Date | null } | undefined) ?? null;
  }
}
