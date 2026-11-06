import { DateTime } from 'luxon';
import { DayRow } from '../scheduling/attendance.service';

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'confirmado',
  PENDING: 'sem confirmação',
  DECLINED: 'recusou',
  ATTENDED: 'atendido',
  NO_SHOW: 'falta',
  LATE_CANCELLED: 'cancelou em cima da hora',
};

const dayLabel = (dateISO: string, timezone: string): string => {
  const today = DateTime.now().setZone(timezone).toISODate();
  const tomorrow = DateTime.now().setZone(timezone).plus({ days: 1 }).toISODate();
  const formatted = DateTime.fromISO(dateISO, { zone: timezone }).toFormat('dd/MM');

  if (dateISO === today) return `hoje (${formatted})`;
  if (dateISO === tomorrow) return `amanhã (${formatted})`;
  return DateTime.fromISO(dateISO, { zone: timezone }).setLocale('pt-BR').toFormat("cccc', 'dd/MM");
};

const statusSuffix = (row: DayRow): string => {
  if (row.attendanceStatus !== 'PENDING') {
    return STATUS_LABEL[row.attendanceStatus] ?? row.attendanceStatus.toLowerCase();
  }
  return STATUS_LABEL[row.confirmationStatus] ?? '';
};

export function formatAgenda(
  rows: DayRow[],
  dateISO: string,
  timezone: string,
): string {
  const header = `Agenda de ${dayLabel(dateISO, timezone)}`;
  const visible = rows.filter(
    (row) => row.status !== 'CANCELLED' && row.status !== 'RESCHEDULE_PENDING',
  );

  if (visible.length === 0) {
    return `${header}\nNenhum atendimento.`;
  }

  const lines = visible.map((row) => {
    const time = DateTime.fromJSDate(row.startAt).setZone(timezone).toFormat('HH:mm');
    const suffix = statusSuffix(row);
    const tail = suffix ? ` (${suffix})` : '';
    return `${time} ${row.serviceName} — ${row.patientLabel}${tail}`;
  });

  return [header, ...lines].join('\n');
}
