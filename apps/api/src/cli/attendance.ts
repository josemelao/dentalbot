import { config as loadDotenv } from 'dotenv';
import { DateTime } from 'luxon';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';
import { AppointmentsRepository } from '../db/repositories/appointments.repository';
import { AuditRepository } from '../db/repositories/audit.repository';
import { CatalogRepository } from '../db/repositories/catalog.repository';
import { PatientsRepository } from '../db/repositories/patients.repository';
import {
  AttendanceMark,
  AttendanceService,
} from '../scheduling/attendance.service';

const USAGE =
  'Usage: npm run attendance -- <list|mark|summary> ...\n' +
  '  list [YYYY-MM-DD]                       day list (default: today)\n' +
  '  mark <appointmentId|prefix> <ATTENDED|NO_SHOW>\n' +
  '  summary [from YYYY-MM-DD] [to YYYY-MM-DD]  (default: last 30 days)';

const pad = (value: string, width: number): string => value.padEnd(width).slice(0, width);

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);

  try {
    const clinics = await pool.query<{ id: string; name: string; timezone: string }>(
      `select id, name, timezone from clinics where status = 'active'
       order by created_at limit 1`,
    );
    const clinic = clinics.rows[0];
    if (!clinic) throw new Error('No active clinic. Run npm run seed first.');

    const service = new AttendanceService({
      appointments: new AppointmentsRepository(pool),
      catalog: new CatalogRepository(pool),
      patients: new PatientsRepository(pool),
      audit: new AuditRepository(pool),
      now: () => new Date(),
    });

    const today = DateTime.now().setZone(clinic.timezone).toISODate() ?? '';
    const [action, ...args] = process.argv.slice(2);

    if (action === 'list') {
      const date = args[0] ?? today;
      const rows = await service.listDay(clinic.id, date);
      if (rows.length === 0) {
        console.log(`${clinic.name} — ${date}: nenhum atendimento.`);
        return;
      }

      console.log(`${clinic.name} — ${date}`);
      console.log(
        `${pad('id', 10)} ${pad('hora', 6)} ${pad('paciente', 16)} ${pad('serviço', 22)} ${pad('status', 12)} ${pad('confirmação', 12)} presença`,
      );
      for (const row of rows) {
        const time = DateTime.fromJSDate(row.startAt)
          .setZone(clinic.timezone)
          .toFormat('HH:mm');
        console.log(
          `${pad(row.id.slice(0, 8), 10)} ${pad(time, 6)} ${pad(row.patientLabel, 16)} ${pad(row.serviceName, 22)} ${pad(row.status, 12)} ${pad(row.confirmationStatus, 12)} ${row.attendanceStatus}`,
        );
      }
      return;
    }

    if (action === 'mark') {
      const [reference, mark] = args;
      if (!reference || (mark !== 'ATTENDED' && mark !== 'NO_SHOW')) {
        throw new Error(USAGE);
      }
      const appointment = await service.mark(clinic.id, reference, mark as AttendanceMark);
      console.log(
        `marcado ${mark}: ${appointment.id.slice(0, 8)} status=${appointment.status} presença=${appointment.attendanceStatus}`,
      );
      return;
    }

    if (action === 'summary') {
      const today30 = DateTime.now().setZone(clinic.timezone).minus({ days: 29 });
      const from = args[0] ?? (today30.toISODate() ?? '');
      const to = args[1] ?? today;
      const summary = await service.summary(clinic.id, from, to);

      console.log(`${clinic.name} — ${from} a ${to}`);
      console.log(`agendados:            ${summary.scheduled}`);
      console.log(`atendidos:            ${summary.attended}`);
      console.log(`faltas:               ${summary.noShow}`);
      console.log(`cancelamentos tardios:${summary.lateCancelled}`);
      console.log(`confirmados:          ${summary.confirmed}`);
      console.log(`recusados:            ${summary.unconfirmed}`);
      console.log(`sem confirmação:      ${summary.pending}`);
      console.log(`taxa de falta:        ${summary.noShowRate}%`);
      console.log(`taxa de confirmação:  ${summary.confirmationRate}%`);
      return;
    }

    throw new Error(USAGE);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
