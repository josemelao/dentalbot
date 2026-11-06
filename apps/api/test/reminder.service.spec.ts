import { FakeChannelAdapter } from '../src/channels/fake/fake-channel.adapter';
import { AppointmentsRepository } from '../src/db/repositories/appointments.repository';
import { AuditRepository } from '../src/db/repositories/audit.repository';
import { CatalogRepository } from '../src/db/repositories/catalog.repository';
import { ConversationsRepository } from '../src/db/repositories/conversations.repository';
import { MessagesRepository } from '../src/db/repositories/messages.repository';
import { PatientsRepository } from '../src/db/repositories/patients.repository';
import { RemindersRepository } from '../src/db/repositories/reminders.repository';
import { formatReminder, ReminderService } from '../src/scheduling/reminder.service';
import { buildBookingService, bookingInput } from './helpers/booking';
import { getTestPool, seedClinic, seedScheduling } from './helpers/db';

const APPOINTMENT_AT = new Date('2026-11-09T12:15:00Z');
const DAY_BEFORE = new Date(APPOINTMENT_AT.getTime() - 24 * 3_600_000);

const build = (pool: any, channel = new FakeChannelAdapter(), now: Date = DAY_BEFORE) => ({
  channel,
  service: new ReminderService({
    appointments: new AppointmentsRepository(pool),
    reminders: new RemindersRepository(pool),
    patients: new PatientsRepository(pool),
    catalog: new CatalogRepository(pool),
    messages: new MessagesRepository(pool),
    conversations: new ConversationsRepository(pool),
    audit: new AuditRepository(pool),
    channel,
    now: () => now,
    minLeadHours: 20,
    maxLeadHours: 28,
  }),
});

const setup = async () => {
  const pool = getTestPool();
  const clinic = await seedClinic(pool, { withConversation: true });
  const scheduling = await seedScheduling(pool, clinic.tenantId);
  const booked = await buildBookingService(pool).book(bookingInput(clinic, scheduling));
  if (booked.status !== 'BOOKED') throw new Error('setup failed');
  return { pool, clinic, scheduling, appointment: booked.appointment };
};

describe('ReminderService', () => {
  it('sends and records the 24h reminder', async () => {
    const { pool, clinic, appointment } = await setup();
    const { service, channel } = build(pool);

    const result = await service.sweepTenant(clinic.tenantId);

    expect(result).toMatchObject({ eligible: 1, sent: 1, failed: 0 });
    expect(channel.sent.at(-1)?.externalUserId).toBe('user-pilot');
    expect(channel.sent.at(-1)?.text).toContain('Lembrete: Limpeza');
    expect(channel.sent.at(-1)?.text).toContain('Responda SIM para confirmar');

    const reminder = await pool.query(
      `select sent_at from appointment_reminders where appointment_id = $1`,
      [appointment.id],
    );
    expect(reminder.rows[0].sent_at).not.toBeNull();

    const confirmation = await pool.query(
      `select confirmation_status from appointments where id = $1`,
      [appointment.id],
    );
    expect(confirmation.rows[0].confirmation_status).toBe('PENDING');
  });

  it('never reminds the same appointment twice', async () => {
    const { pool, clinic } = await setup();
    const { service, channel } = build(pool);

    await service.sweepTenant(clinic.tenantId);
    const second = await service.sweepTenant(clinic.tenantId);

    expect(second.eligible).toBe(0);
    expect(channel.sent).toHaveLength(1);
  });

  it('does nothing outside the reminder window', async () => {
    const { pool, clinic } = await setup();
    const { service, channel } = build(
      pool,
      new FakeChannelAdapter(),
      new Date(APPOINTMENT_AT.getTime() - 40 * 3_600_000),
    );

    const result = await service.sweepTenant(clinic.tenantId);

    expect(result.eligible).toBe(0);
    expect(channel.sent).toHaveLength(0);
  });

  it('skips an opted-out contact', async () => {
    const { pool, clinic, appointment } = await setup();
    await pool.query(
      `update patient_contacts set opt_in_status = 'opted_out'
       where tenant_id = $1 and id = (select patient_contact_id from appointments where id = $2)`,
      [clinic.tenantId, appointment.id],
    );
    const { service, channel } = build(pool);

    const result = await service.sweepTenant(clinic.tenantId);

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(channel.sent).toHaveLength(0);
  });

  it('ignores a cancelled appointment', async () => {
    const { pool, clinic, appointment } = await setup();
    await pool.query(`update appointments set status = 'CANCELLED' where id = $1`, [
      appointment.id,
    ]);
    const { service, channel } = build(pool);

    const result = await service.sweepTenant(clinic.tenantId);

    expect(result.eligible).toBe(0);
    expect(channel.sent).toHaveLength(0);
  });

  it('frees the claim when the channel fails, so the next run retries', async () => {
    const { pool, clinic, appointment } = await setup();
    class FailingChannel extends FakeChannelAdapter {
      async send(): Promise<{ externalMessageId: string }> {
        throw new Error('telegram down');
      }
    }

    const first = await build(pool, new FailingChannel()).service.sweepTenant(clinic.tenantId);
    expect(first.failed).toBe(1);

    const remaining = await pool.query(
      `select count(*)::int as n from appointment_reminders where appointment_id = $1`,
      [appointment.id],
    );
    expect(remaining.rows[0].n).toBe(0);

    const retry = await build(pool).service.sweepTenant(clinic.tenantId);
    expect(retry.sent).toBe(1);
  });
});

describe('formatReminder', () => {
  it('states the service, the local time and the two replies', () => {
    const text = formatReminder('Limpeza', APPOINTMENT_AT, 'America/Sao_Paulo');
    expect(text).toContain('Lembrete: Limpeza em');
    expect(text).toContain('09:15');
    expect(text).toContain('SIM');
    expect(text).toContain('CANCELAR');
  });
});
