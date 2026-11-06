import { Pool } from 'pg';
import { CalendarAdapter } from '../calendar/calendar-adapter';
import { ChannelAdapter } from '../channels/channel-adapter';
import { ChannelOwnerNotifier } from '../channels/owner-notifier';
import { AppEnv } from '../config/env';
import { AppointmentsRepository } from '../db/repositories/appointments.repository';
import { AuditRepository } from '../db/repositories/audit.repository';
import { CatalogRepository } from '../db/repositories/catalog.repository';
import { ChannelsRepository } from '../db/repositories/channels.repository';
import { ConversationsRepository } from '../db/repositories/conversations.repository';
import { LocksRepository } from '../db/repositories/locks.repository';
import { MessagesRepository } from '../db/repositories/messages.repository';
import { OperationsRepository } from '../db/repositories/operations.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import { RemindersRepository } from '../db/repositories/reminders.repository';
import { TicketsRepository } from '../db/repositories/tickets.repository';
import { SlaService } from '../pipeline/sla.service';
import { IdleTicketService } from '../pipeline/idle-ticket.service';
import { EscalationService } from '../pipeline/escalation.service';
import { CalendarSyncService } from '../scheduling/calendar-sync.service';
import { ReconciliationService } from '../scheduling/reconciliation.service';
import { ReminderService } from '../scheduling/reminder.service';

export interface WorkerJob {
  name: string;
  run(): Promise<Record<string, unknown>>;
}

export interface BuildJobsOptions {
  pool: Pool;
  env: AppEnv;
  channel: ChannelAdapter;
  calendar: CalendarAdapter;
  now?: () => Date;
}

export function buildJobs(options: BuildJobsOptions): WorkerJob[] {
  const { pool, env, channel, calendar } = options;
  const now = options.now ?? (() => new Date());

  const tickets = new TicketsRepository(pool);
  const messages = new MessagesRepository(pool);
  const conversations = new ConversationsRepository(pool);
  const patients = new PatientsRepository(pool);
  const audit = new AuditRepository(pool);
  const appointments = new AppointmentsRepository(pool);
  const reminders = new RemindersRepository(pool);
  const catalog = new CatalogRepository(pool);
  const locks = new LocksRepository(pool);
  const operations = new OperationsRepository(pool);

  const sla = new SlaService({
    tickets,
    messages,
    conversations,
    patients,
    audit,
    channel,
    now,
  });

  const reminderService = new ReminderService({
    appointments,
    reminders,
    patients,
    catalog,
    messages,
    conversations,
    audit,
    channel,
    now,
    minLeadHours: env.reminderMinLeadHours,
    maxLeadHours: env.reminderMaxLeadHours,
  });

  const reconciliation = new ReconciliationService({
    operations,
    appointments,
    locks,
    calendar,
  });

  const escalation = new EscalationService({
    tickets,
    channels: new ChannelsRepository(pool),
    conversations,
    patients,
    messages,
    audit,
    notifier: new ChannelOwnerNotifier(channel),
    ownerChannel: 'telegram',
    channel,
    slaMinutes: env.slaMinutes,
  });

  const idleTickets = new IdleTicketService({
    tickets,
    escalation,
    now,
    idleMinutes: env.idleAssumedMinutes,
  });

  const calendarSync = new CalendarSyncService({
    appointments,
    escalation,
    audit,
    calendar,
    now,
    horizonDays: 7,
  });

  const activeClinics = async (): Promise<string[]> => {
    const { rows } = await pool.query<{ id: string }>(
      `select id from clinics where status = 'active' order by name`,
    );
    return rows.map((row) => row.id);
  };

  return [
    {
      name: 'sla',
      run: async () => {
        let delivered = 0;
        let overdue = 0;
        for (const tenantId of await activeClinics()) {
          const result = await sla.sweepTenant(tenantId);
          delivered += result.delivered;
          overdue += result.overdue;
        }
        return { overdue, delivered };
      },
    },
    {
      name: 'reminders',
      run: async () => {
        let sent = 0;
        let failed = 0;
        let skipped = 0;
        for (const tenantId of await activeClinics()) {
          const result = await reminderService.sweepTenant(tenantId);
          sent += result.sent;
          failed += result.failed;
          skipped += result.skipped;
        }
        return { sent, failed, skipped };
      },
    },
    {
      name: 'idle',
      run: async () => {
        let idle = 0;
        let alerted = 0;
        for (const tenantId of await activeClinics()) {
          const result = await idleTickets.sweepTenant(tenantId);
          idle += result.idle;
          alerted += result.alerted;
        }
        return { idle, alerted };
      },
    },
    {
      name: 'calendar',
      run: async () => {
        let missing = 0;
        let moved = 0;
        let checked = 0;
        for (const tenantId of await activeClinics()) {
          const result = await calendarSync.syncTenant(tenantId);
          checked += result.checked;
          missing += result.missing;
          moved += result.moved;
        }
        return { checked, missing, moved };
      },
    },
    {
      name: 'reconcile',
      run: async () => {
        const releasedLocks = await reconciliation.releaseExpiredLocks(now());
        const { rows } = await pool.query<{ tenantId: string }>(
          `select distinct tenant_id as "tenantId"
           from appointment_operations where status = 'UNKNOWN'`,
        );

        let confirmed = 0;
        let failed = 0;
        for (const row of rows) {
          const summary = await reconciliation.reconcileUnknown(row.tenantId);
          confirmed += summary.confirmed;
          failed += summary.failed;
        }
        return { releasedLocks, confirmed, failed };
      },
    },
  ];
}
