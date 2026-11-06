import { formatAgenda } from '../src/pipeline/agenda-messages';
import { DayRow } from '../src/scheduling/attendance.service';

const row = (overrides: Partial<DayRow> = {}): DayRow => ({
  id: 'a1',
  startAt: new Date('2026-11-09T12:15:00Z'),
  serviceName: 'Limpeza',
  patientLabel: 'Maria',
  status: 'BOOKED',
  confirmationStatus: 'PENDING',
  attendanceStatus: 'PENDING',
  ...overrides,
});

const TZ = 'America/Sao_Paulo';

describe('formatAgenda', () => {
  it('lists time, service, patient and confirmation', () => {
    const text = formatAgenda(
      [row({ confirmationStatus: 'CONFIRMED' })],
      '2026-11-09',
      TZ,
    );

    expect(text).toContain('Agenda de');
    expect(text).toContain('09:15 Limpeza — Maria (confirmado)');
  });

  it('marks attendance when it is already closed', () => {
    const text = formatAgenda(
      [row({ attendanceStatus: 'ATTENDED', status: 'COMPLETED' })],
      '2026-11-09',
      TZ,
    );

    expect(text).toContain('(atendido)');
  });

  it('hides cancelled appointments', () => {
    const text = formatAgenda(
      [
        row({ status: 'CANCELLED', patientLabel: 'Cancelada' }),
        row({ id: 'a2', patientLabel: 'João' }),
      ],
      '2026-11-09',
      TZ,
    );

    expect(text).not.toContain('Cancelada');
    expect(text).toContain('João');
  });

  it('says when the day is empty', () => {
    expect(formatAgenda([], '2026-11-09', TZ)).toContain('Nenhum atendimento');
  });
});
