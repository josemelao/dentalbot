import { getTestPool, seedClinic, seedScheduling } from './helpers/db';

const fixture = async () => {
  const pool = getTestPool();
  const clinic = await seedClinic(pool, { withConversation: true });
  const scheduling = await seedScheduling(pool, clinic.tenantId);
  return { pool, clinic, scheduling };
};

const createAppointment = async (
  pool: any,
  ids: any,
  startAt: string,
  endAt: string,
  status = 'BOOKED',
) => {
  const { rows } = await pool.query(
    `insert into appointments
       (tenant_id, patient_contact_id, service_id, location_id, resource_id,
        start_at, end_at, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      ids.tenantId,
      ids.contactId,
      ids.cleaningServiceId,
      ids.locationId,
      ids.resourceId,
      startAt,
      endAt,
      status,
    ],
  );
  return rows[0].id as string;
};

const reserveProfessional = (
  pool: any,
  ids: any,
  appointmentId: string,
  startAt: string,
  endAt: string,
  status = 'BOOKED',
) =>
  pool.query(
    `insert into professional_reservations
       (tenant_id, appointment_id, professional_id, start_at, end_at, status)
     values ($1, $2, $3, $4, $5, $6)`,
    [ids.tenantId, appointmentId, ids.caioId, startAt, endAt, status],
  );

describe('appointment schema', () => {
  it('rejects overlapping professional reservations', async () => {
    const { pool, clinic, scheduling: s } = await fixture();
    const ids = { ...clinic, ...s };
    const first = await createAppointment(pool, ids, '2026-11-09T12:00:00Z', '2026-11-09T13:00:00Z');
    const second = await createAppointment(pool, ids, '2026-11-09T12:30:00Z', '2026-11-09T13:30:00Z');

    await reserveProfessional(pool, ids, first, '2026-11-09T12:00:00Z', '2026-11-09T13:00:00Z');
    await expect(
      reserveProfessional(pool, ids, second, '2026-11-09T12:30:00Z', '2026-11-09T13:30:00Z'),
    ).rejects.toThrow(/exclusion constraint|conflicting key/);
  });

  it('does not block a released professional reservation', async () => {
    const { pool, clinic, scheduling: s } = await fixture();
    const ids = { ...clinic, ...s };
    const first = await createAppointment(pool, ids, '2026-11-09T12:00:00Z', '2026-11-09T13:00:00Z');
    const second = await createAppointment(pool, ids, '2026-11-09T12:30:00Z', '2026-11-09T13:30:00Z');

    await reserveProfessional(
      pool,
      ids,
      first,
      '2026-11-09T12:00:00Z',
      '2026-11-09T13:00:00Z',
      'RELEASED',
    );
    await expect(
      reserveProfessional(pool, ids, second, '2026-11-09T12:30:00Z', '2026-11-09T13:30:00Z'),
    ).resolves.toBeDefined();
  });

  it('rejects overlapping resource reservations on the single chair', async () => {
    const { pool, clinic, scheduling: s } = await fixture();
    const ids = { ...clinic, ...s };
    const first = await createAppointment(pool, ids, '2026-11-09T12:00:00Z', '2026-11-09T13:00:00Z');
    const second = await createAppointment(pool, ids, '2026-11-09T12:30:00Z', '2026-11-09T13:30:00Z');
    const reserveResource = (appointmentId: string, startAt: string, endAt: string) =>
      pool.query(
        `insert into resource_reservations
           (tenant_id, appointment_id, resource_id, start_at, end_at, status)
         values ($1, $2, $3, $4, $5, 'BOOKED')`,
        [ids.tenantId, appointmentId, ids.resourceId, startAt, endAt],
      );

    await reserveResource(first, '2026-11-09T12:00:00Z', '2026-11-09T13:00:00Z');
    await expect(
      reserveResource(second, '2026-11-09T12:30:00Z', '2026-11-09T13:30:00Z'),
    ).rejects.toThrow(/exclusion constraint|conflicting key/);
  });

  it('rejects a duplicate idempotency key per tenant', async () => {
    const { pool, clinic } = await fixture();
    const insert = () =>
      pool.query(
        `insert into appointment_operations
           (tenant_id, idempotency_key, operation_type)
         values ($1, 'same-key', 'BOOK')`,
        [clinic.tenantId],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  it('rejects an appointment that ends before it starts', async () => {
    const { pool, clinic, scheduling: s } = await fixture();
    await expect(
      createAppointment(
        pool,
        { ...clinic, ...s },
        '2026-11-09T13:00:00Z',
        '2026-11-09T12:00:00Z',
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
