import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { CatalogRepository } from '../src/db/repositories/catalog.repository';
import { AppointmentsRepository } from '../src/db/repositories/appointments.repository';
import { OperationsRepository } from '../src/db/repositories/operations.repository';

describe('scheduling repositories', () => {
  it('never returns another tenant service', async () => {
    const pool = getTestPool();
    const a = await seedClinic(pool, { suffix: 'a' });
    const b = await seedClinic(pool, { suffix: 'b' });
    const sa = await seedScheduling(pool, a.tenantId);
    const repo = new CatalogRepository(pool);

    expect(await repo.findService(b.tenantId, sa.cleaningServiceId)).toBeNull();
    expect((await repo.findService(a.tenantId, sa.cleaningServiceId))?.name).toBe('Limpeza');
  });

  it('rolls back the appointment when a reservation conflicts', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const repo = new AppointmentsRepository(pool);

    const input = {
      tenantId: clinic.tenantId,
      patientContactId: clinic.contactId!,
      serviceId: s.cleaningServiceId,
      locationId: s.locationId,
      resourceId: s.resourceId,
      startAt: new Date('2026-11-09T12:00:00Z'),
      endAt: new Date('2026-11-09T13:00:00Z'),
      blockingStartAt: new Date('2026-11-09T12:00:00Z'),
      blockingEndAt: new Date('2026-11-09T13:10:00Z'),
      professionals: [{ id: s.caioId, role: 'primary' as const }],
    };

    await repo.createWithReservations(input);
    await expect(repo.createWithReservations(input)).rejects.toThrow(
      /exclusion constraint|conflicting key/,
    );

    const count = await pool.query(
      `select count(*)::int as n from appointments where tenant_id = $1`,
      [clinic.tenantId],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('returns the same operation for a repeated idempotency key', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const repo = new OperationsRepository(pool);

    const first = await repo.createOrGet({
      tenantId: clinic.tenantId,
      idempotencyKey: 'key-1',
      operationType: 'BOOK',
      requestPayload: { serviceId: 'x' },
    });
    const second = await repo.createOrGet({
      tenantId: clinic.tenantId,
      idempotencyKey: 'key-1',
      operationType: 'BOOK',
      requestPayload: { serviceId: 'x' },
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.operation.id).toBe(first.operation.id);
  });
});
