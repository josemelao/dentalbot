import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';
import { RecordingOwnerNotifier } from '../src/channels/owner-notifier';
import { AuditRepository } from '../src/db/repositories/audit.repository';
import { AppointmentsRepository } from '../src/db/repositories/appointments.repository';
import { ChannelsRepository } from '../src/db/repositories/channels.repository';
import { ConversationsRepository } from '../src/db/repositories/conversations.repository';
import { MessagesRepository } from '../src/db/repositories/messages.repository';
import { PatientsRepository } from '../src/db/repositories/patients.repository';
import { TicketsRepository } from '../src/db/repositories/tickets.repository';
import { EscalationService } from '../src/pipeline/escalation.service';
import { CalendarSyncService } from '../src/scheduling/calendar-sync.service';
import { FakeChannelAdapter } from '../src/channels/fake/fake-channel.adapter';
import { buildBookingService, bookingInput } from './helpers/booking';
import { getTestPool, seedClinic, seedScheduling } from './helpers/db';

const NOW = new Date('2026-11-09T09:00:00Z');

const buildSync = (pool: any, calendar: FakeCalendarAdapter) => {
  const notifier = new RecordingOwnerNotifier();
  const escalation = new EscalationService({
    tickets: new TicketsRepository(pool),
    channels: new ChannelsRepository(pool),
    conversations: new ConversationsRepository(pool),
    patients: new PatientsRepository(pool),
    messages: new MessagesRepository(pool),
    audit: new AuditRepository(pool),
    notifier,
    ownerChannel: 'telegram',
    channel: new FakeChannelAdapter(),
    slaMinutes: 15,
  });

  return {
    notifier,
    service: new CalendarSyncService({
      appointments: new AppointmentsRepository(pool),
      escalation,
      audit: new AuditRepository(pool),
      calendar,
      now: () => NOW,
      horizonDays: 7,
    }),
  };
};

const book = async () => {
  const pool = getTestPool();
  const clinic = await seedClinic(pool, { withConversation: true });
  const scheduling = await seedScheduling(pool, clinic.tenantId);
  const calendar = new FakeCalendarAdapter();
  const booking = buildBookingService(pool, calendar);

  const booked = await booking.book(bookingInput(clinic, scheduling));
  if (booked.status !== 'BOOKED') throw new Error('setup failed');

  return { pool, clinic, calendar, appointment: booked.appointment };
};

describe('CalendarSyncService', () => {
  it('marks the appointment when the event was deleted in Google', async () => {
    const { pool, clinic, calendar, appointment } = await book();
    calendar.events.delete(appointment.googleEventId as string);

    const { service, notifier } = buildSync(pool, calendar);
    const result = await service.syncTenant(clinic.tenantId);

    expect(result).toMatchObject({ checked: 1, missing: 1, moved: 0 });

    const row = await pool.query(
      `select status from appointments where id = $1`,
      [appointment.id],
    );
    expect(row.rows[0].status).toBe('RESCHEDULE_REQUIRED');

    const reservations = await pool.query(
      `select status from professional_reservations where appointment_id = $1`,
      [appointment.id],
    );
    expect(reservations.rows[0].status).toBe('RELEASED');

    expect(notifier.deliveries[0].text).toContain('removido no Google');
  });

  it('marks the appointment when the event was moved in Google', async () => {
    const { pool, clinic, calendar, appointment } = await book();
    const event = calendar.events.get(appointment.googleEventId as string);
    if (!event) throw new Error('event missing');
    calendar.events.set(appointment.googleEventId as string, {
      ...event,
      startAt: new Date(event.startAt.getTime() + 3_600_000),
      endAt: new Date(event.endAt.getTime() + 3_600_000),
    });

    const { service, notifier } = buildSync(pool, calendar);
    const result = await service.syncTenant(clinic.tenantId);

    expect(result).toMatchObject({ checked: 1, missing: 0, moved: 1 });
    expect(notifier.deliveries[0].text).toContain('movido no Google');
  });

  it('does nothing when the event is intact', async () => {
    const { pool, clinic, calendar } = await book();
    const { service, notifier } = buildSync(pool, calendar);

    const result = await service.syncTenant(clinic.tenantId);

    expect(result).toMatchObject({ checked: 1, missing: 0, moved: 0 });
    expect(notifier.deliveries).toHaveLength(0);
  });
});
