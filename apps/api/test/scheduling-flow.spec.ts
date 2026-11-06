import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { buildBookingService, bookingInput } from './helpers/booking';
import { CatalogRepository } from '../src/db/repositories/catalog.repository';
import { AppointmentsRepository } from '../src/db/repositories/appointments.repository';
import { PatientsRepository } from '../src/db/repositories/patients.repository';
import { AvailabilityService } from '../src/scheduling/availability.service';
import { SlotEngine } from '../src/scheduling/slot-engine';
import { SchedulingFlowService } from '../src/scheduling/scheduling-flow.service';

const linkPatient = async (pool: any, clinic: any) => {
  const {
    rows: [patient],
  } = await pool.query(
    `insert into patients (tenant_id, full_name, birth_date)
     values ($1, 'Maria Silva', '1990-05-10') returning id`,
    [clinic.tenantId],
  );
  await pool.query(`update patient_contacts set patient_id = $1 where id = $2`, [
    patient.id,
    clinic.contactId,
  ]);
};

const build = (pool: any) => {
  const catalog = new CatalogRepository(pool);
  const availability = new AvailabilityService(catalog, new SlotEngine(), {
    granularityMinutes: 15,
    minAdvanceMinutes: 0,
    maxHorizonDays: 90,
  });
  const booking = buildBookingService(pool);
  return {
    booking,
    flow: new SchedulingFlowService({
      catalog,
      availability,
      appointments: new AppointmentsRepository(pool),
      patients: new PatientsRepository(pool),
      booking,
      now: () => new Date('2026-11-08T12:00:00-03:00'),
      horizonDays: 7,
    }),
  };
};

describe('SchedulingFlowService', () => {
  it('offers slots, accepts a choice and confirms the booking', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    await seedScheduling(pool, clinic.tenantId);
    const { flow } = build(pool);

    const offered = await flow.start({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'quero marcar limpeza',
      intent: 'SCHEDULE_REQUEST',
      context: null,
    });
    expect(offered.context?.step).toBe('SLOT');
    expect(offered.reply).toMatch(/1\)/);

    const chosen = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: '1',
      context: offered.context!,
    });
    expect(chosen.context?.step).toBe('CONFIRM');
    expect(chosen.reply).toMatch(/SIM/);

    const confirmed = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'SIM',
      context: chosen.context!,
    });
    expect(confirmed.status).toBe('COMPLETED');
    expect(confirmed.context).toBeNull();
    expect(confirmed.appointmentId).toBeTruthy();
  });

  it('offers an evaluation when the service requires it', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    await seedScheduling(pool, clinic.tenantId);
    const { flow } = build(pool);

    const result = await flow.start({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'quero marcar implante',
      intent: 'SCHEDULE_REQUEST',
      context: null,
    });
    expect(result.reply.toLowerCase()).toContain('avaliação');
    expect(result.context?.serviceId).toBeTruthy();
  });

  it('asks to start over when the context expired', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    await seedScheduling(pool, clinic.tenantId);
    const { flow } = build(pool);

    const result = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: '1',
      context: {
        flow: 'SCHEDULE',
        step: 'SLOT',
        idempotencyKey: 'expired',
        offeredSlots: [],
        expiresAt: '2026-11-08T11:00:00-03:00',
      },
    });
    expect(result.reply.toLowerCase()).toContain('expirou');
    expect(result.context).toBeNull();
  });

  it('starts a cancel flow by asking for identity confirmation', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const { flow, booking } = build(pool);

    const booked = await booking.book(bookingInput(clinic, s));
    if (booked.status !== 'BOOKED') throw new Error('setup failed');

    const result = await flow.start({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'quero cancelar',
      intent: 'CANCEL_REQUEST',
      context: null,
    });
    expect(result.context?.step).toBe('IDENTITY');
    expect(result.reply.toLowerCase()).toMatch(/nome completo|data de nascimento/);
  });

  it('reschedules after identity verification', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const { flow, booking } = build(pool);
    await linkPatient(pool, clinic);

    const booked = await booking.book(bookingInput(clinic, s));
    if (booked.status !== 'BOOKED') throw new Error('setup failed');

    const started = await flow.start({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'quero remarcar',
      intent: 'RESCHEDULE_REQUEST',
      context: null,
    });
    expect(started.context?.step).toBe('IDENTITY');

    const verified = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'Maria Silva, 10/05/1990',
      context: started.context!,
    });
    expect(verified.context?.step).toBe('SLOT');

    const chosen = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: '1',
      context: verified.context!,
    });
    expect(chosen.context?.step).toBe('CONFIRM');

    const confirmed = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'SIM',
      context: chosen.context!,
    });
    expect(confirmed.status).toBe('COMPLETED');

    const oldRow = await pool.query(`select status from appointments where id = $1`, [
      booked.appointment.id,
    ]);
    expect(oldRow.rows[0].status).toBe('CANCELLED');
  });

  it('accepts an ordinal instead of a number', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const { flow } = build(pool);

    const result = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'pode ser a segunda',
      context: {
        flow: 'SCHEDULE',
        step: 'SLOT',
        serviceId: s.cleaningServiceId,
        timezone: 'America/Sao_Paulo',
        idempotencyKey: 'ordinal',
        expiresAt: '2026-11-08T15:30:00Z',
        offeredSlots: [
          { startAt: '2026-11-09T12:15:00Z', professionalIds: [s.caioId], resourceId: null },
          { startAt: '2026-11-09T13:15:00Z', professionalIds: [s.caioId], resourceId: null },
          { startAt: '2026-11-13T12:15:00Z', professionalIds: [s.caioId], resourceId: null },
        ],
      },
    });

    expect(result.context?.step).toBe('CONFIRM');
    expect(result.reply).toContain('10:15');
  });

  it('accepts a weekday instead of a number', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const { flow } = build(pool);

    const result = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'sexta pode ser',
      context: {
        flow: 'SCHEDULE',
        step: 'SLOT',
        serviceId: s.cleaningServiceId,
        timezone: 'America/Sao_Paulo',
        idempotencyKey: 'weekday',
        expiresAt: '2026-11-08T15:30:00Z',
        offeredSlots: [
          { startAt: '2026-11-09T12:15:00Z', professionalIds: [s.caioId], resourceId: null },
          { startAt: '2026-11-09T13:15:00Z', professionalIds: [s.caioId], resourceId: null },
          { startAt: '2026-11-13T12:15:00Z', professionalIds: [s.caioId], resourceId: null },
        ],
      },
    });

    expect(result.context?.step).toBe('CONFIRM');
    expect(result.reply).toContain('13/11');
  });

  it('asks again when the choice is ambiguous', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const { flow } = build(pool);

    const result = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'qualquer um de manhã',
      context: {
        flow: 'SCHEDULE',
        step: 'SLOT',
        serviceId: s.cleaningServiceId,
        timezone: 'America/Sao_Paulo',
        idempotencyKey: 'ambiguous',
        expiresAt: '2026-11-08T15:30:00Z',
        offeredSlots: [
          { startAt: '2026-11-09T12:15:00Z', professionalIds: [s.caioId], resourceId: null },
          { startAt: '2026-11-09T13:15:00Z', professionalIds: [s.caioId], resourceId: null },
        ],
      },
    });

    expect(result.context?.step).toBe('SLOT');
    expect(result.reply).toContain('1)');
  });

  it('accepts a birth date written in words', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const { flow, booking } = build(pool);
    await linkPatient(pool, clinic);

    const booked = await booking.book(bookingInput(clinic, s));
    if (booked.status !== 'BOOKED') throw new Error('setup failed');

    const started = await flow.start({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'quero cancelar',
      intent: 'CANCEL_REQUEST',
      context: null,
    });

    const verified = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: '10 de maio de 1990, Maria Silva',
      context: started.context!,
    });

    expect(verified.context?.step).toBe('CONFIRM');
    expect(verified.reply).toContain('SIM');
  });

  it('does not reschedule when the identity does not match', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const { flow, booking } = build(pool);
    await linkPatient(pool, clinic);

    const booked = await booking.book(bookingInput(clinic, s));
    if (booked.status !== 'BOOKED') throw new Error('setup failed');

    const started = await flow.start({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'quero remarcar',
      intent: 'RESCHEDULE_REQUEST',
      context: null,
    });
    const wrong = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'João Silva, 01/01/1990',
      context: started.context!,
    });
    expect(wrong.status).toBe('REQUIRES_HUMAN');

    const row = await pool.query(`select status from appointments where id = $1`, [
      booked.appointment.id,
    ]);
    expect(row.rows[0].status).toBe('BOOKED');
  });

  it('does not cancel on ambiguous language, only on explicit SIM', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const { flow, booking } = build(pool);
    await linkPatient(pool, clinic);

    const booked = await booking.book(bookingInput(clinic, s));
    if (booked.status !== 'BOOKED') throw new Error('setup failed');

    const started = await flow.start({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'quero cancelar',
      intent: 'CANCEL_REQUEST',
      context: null,
    });
    const verified = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'Maria Silva, 10/05/1990',
      context: started.context!,
    });
    expect(verified.context?.step).toBe('CONFIRM');

    const ambiguous = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'acho que não vou conseguir',
      context: verified.context!,
    });
    expect(ambiguous.context?.step).toBe('CONFIRM');

    const stillBooked = await pool.query(`select status from appointments where id = $1`, [
      booked.appointment.id,
    ]);
    expect(stillBooked.rows[0].status).toBe('BOOKED');

    const confirmed = await flow.handleReply({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'SIM',
      context: ambiguous.context!,
    });
    expect(confirmed.status).toBe('COMPLETED');

    const cancelled = await pool.query(`select status from appointments where id = $1`, [
      booked.appointment.id,
    ]);
    expect(cancelled.rows[0].status).toBe('CANCELLED');
  });

  it('does not silently pick one of multiple appointments', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const { flow, booking } = build(pool);

    const first = await booking.book(bookingInput(clinic, s, { idempotencyKey: 'one' }));
    const second = await booking.book(
      bookingInput(clinic, s, {
        idempotencyKey: 'two',
        startAt: new Date('2026-11-09T13:15:00Z'),
      }),
    );
    if (first.status !== 'BOOKED' || second.status !== 'BOOKED') {
      throw new Error('setup failed');
    }

    const result = await flow.start({
      tenantId: clinic.tenantId,
      conversationId: clinic.conversationId!,
      patientContactId: clinic.contactId!,
      text: 'quero cancelar',
      intent: 'CANCEL_REQUEST',
      context: null,
    });
    expect(result.status).toBe('REQUIRES_HUMAN');
    expect(result.context).toBeNull();
  });
});
