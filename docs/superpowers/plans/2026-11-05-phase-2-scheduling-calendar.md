# Phase 2 — Scheduling, Rescheduling and Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the scheduling vertical slice: a service and professional are chosen, real availability is computed, a slot is reserved atomically, the appointment is mirrored to a calendar adapter and verified, and reschedule/cancel work without losing the original slot or double-booking.

**Architecture:** The internal agenda is the source of truth. PostgreSQL enforces non-overlap through exclusion constraints on per-professional and per-resource reservations. `appointment_operations` makes booking/reschedule/cancel idempotent; `availability_locks` reduce wasted calendar calls; `UNKNOWN` is a first-class status reconciled by `operation_id`. Google Calendar is an adapter behind the same interface as the deterministic fake.

**Tech Stack:** Node 24, NestJS 11, PostgreSQL 16 (`btree_gist`), `pg`, Zod, Luxon, Jest, Supertest.

**Spec:** `0 - MVP Blueprint - Dental Assistant.md` plus the Phase 2 fixture dataset in `docs/discovery/2026-11-05-clinica-ficticia-e-checklist-entrevista.md`. The fictional dataset is the development/test fixture; the real clinic data replaces it before go-live.

## Global Constraints

- All Phase 0–1 constraints remain in force: `tenant_id` from `clinic_channels`, no clinical advice, no n8n in the critical path, no PII in logs, `UNKNOWN` is first-class.
- Instants are `timestamptz` in UTC. Working hours are interpreted in the clinic IANA timezone (`America/Sao_Paulo` in the fixture).
- Money is `numeric(12,2)`, never float.
- No double booking: the database exclusion constraint is the final guard, not an application `if`.
- Reschedule never cancels the old appointment before the new reservation and calendar event are verified.
- Joint procedures require **every** required professional to be free; one busy professional means no slot.
- A resource (chair/room) is reserved independently of professionals; one chair cannot host two appointments at once.
- Calendar failures never silently confirm. The appointment becomes `UNKNOWN` and is reconciled by `operation_id`.
- Scheduling is administrative: the bot does not decide clinical suitability, only whether the configured rule allows direct booking or requires evaluation.
- The fictional catalog is for development; the pilot seed is a separate, validated configuration.
- Commits are small: one task, one commit.

## Review Focus

1. **Double booking under concurrency** — two patients choosing the same professional/slot at the same time must produce exactly one `BOOKED` appointment.
2. **Joint procedure with one busy professional** — the engine must not offer a slot unless every required professional is free.
3. **Reschedule loses the original** — if the new booking or event fails, the old appointment must remain valid; if the old cancellation fails after the new one is confirmed, both states must be visible and reconcilable.
4. **Calendar timeout / orphan event** — an event may exist even when the API call timed out; `UNKNOWN` must be reconciled by `operation_id`, never blindly retried.
5. **Timezone, buffer, holiday and lunch** — a slot that looks free must not cross working hours, lunch, holidays, time off, buffers, minimum advance or maximum horizon.

Each line is pinned by a test in Tasks 4, 7, 8, 9 and 11.

## File Structure

```
apps/api/src/scheduling/
  types.ts                     # Slot, SlotRequest, BookingOutcome, statuses
  slot-engine.ts               # pure, deterministic availability calculation
  availability.service.ts      # loads DB data and calls the engine
  booking.service.ts           # book/reschedule/cancel, idempotency, locks
  scheduling-flow.service.ts   # multi-turn conversation flow
  reconciliation.service.ts    # UNKNOWN and expired locks
apps/api/src/calendar/
  calendar-adapter.ts          # interface + CalendarEvent
  fake-calendar.adapter.ts     # deterministic in-memory adapter
  google-calendar.adapter.ts   # fetch-based Google adapter
apps/api/src/db/repositories/
  catalog.repository.ts        # services, professionals, hours, holidays, resources
  appointments.repository.ts   # appointments, professionals, reservations
  operations.repository.ts     # appointment_operations
  locks.repository.ts          # availability_locks
apps/api/src/cli/reconcile.ts
supabase/migrations/
  0008_scheduling_catalog.sql
  0009_appointments.sql
  0010_conversation_context.sql
apps/api/test/
  migrations.scheduling.spec.ts
  migrations.appointments.spec.ts
  catalog.repository.spec.ts
  slot-engine.spec.ts
  availability.service.spec.ts
  fake-calendar.adapter.spec.ts
  booking.service.spec.ts
  booking.concurrency.spec.ts
  booking.timeout.spec.ts
  reschedule.service.spec.ts
  cancel.service.spec.ts
  google-calendar.adapter.spec.ts
  reconciliation.service.spec.ts
  scheduling-flow.spec.ts
  e2e.scheduling.spec.ts
  helpers/scheduling.ts        # seedScheduling fixtures
```

---

### Task 1: Catalog and professional schema

**Files:**
- Create: `supabase/migrations/0008_scheduling_catalog.sql`
- Modify: `apps/api/test/helpers/db.ts` (add `seedScheduling`)
- Test: `apps/api/test/migrations.scheduling.spec.ts`

**Interfaces:**
- Produces tables `locations`, `resources`, `professionals`, `professional_working_hours`, `professional_time_off`, `clinic_holidays`, `services`, `service_variants`, `professional_services`, `service_professional_requirements`.
- Produces `seedScheduling(pool, tenantId, overrides?): Promise<{ locationId; resourceId; chowId; caioId; cleaningServiceId; extractionServiceId; jointServiceId }>` with the fictional dataset (one location, one chair, two professionals, services, hours, joint requirements).
- Adds `unique (tenant_id, id)` to `clinic_users` so professionals can reference users with composite tenant FKs.

- [ ] **Step 1: Write the failing test**

```ts
import { getTestPool, seedClinic } from './helpers/db';

describe('scheduling catalog schema', () => {
  it('creates catalog, professional and service tables', async () => {
    const pool = getTestPool();
    const { rows } = await pool.query(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = rows.map((row: { table_name: string }) => row.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'locations',
        'resources',
        'professionals',
        'professional_working_hours',
        'professional_time_off',
        'clinic_holidays',
        'services',
        'service_variants',
        'professional_services',
        'service_professional_requirements',
      ]),
    );
  });

  it('rejects working hours whose start is not before end', async () => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    const location = await pool.query(
      `insert into locations (tenant_id, name) values ($1, 'Unidade') returning id`,
      [tenantId],
    );
    const professional = await pool.query(
      `insert into professionals (tenant_id, location_id, name)
       values ($1, $2, 'Dr. Teste') returning id`,
      [tenantId, location.rows[0].id],
    );
    await expect(
      pool.query(
        `insert into professional_working_hours
           (tenant_id, professional_id, location_id, weekday, start_time, end_time)
         values ($1, $2, $3, 1, '18:00', '09:00')`,
        [tenantId, professional.rows[0].id, location.rows[0].id],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('rejects a service variant whose max quantity is below min', async () => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    const service = await pool.query(
      `insert into services (tenant_id, name, duration_minutes, price)
       values ($1, 'Extração', 60, 350) returning id`,
      [tenantId],
    );
    await expect(
      pool.query(
        `insert into service_variants
           (tenant_id, service_id, min_quantity, max_quantity, price, duration_minutes)
         values ($1, $2, 3, 2, 900, 90)`,
        [tenantId, service.rows[0].id],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('allows one habilitation per professional and service', async () => {
    const pool = getTestPool();
    const { tenantId } = await seedClinic(pool);
    const location = await pool.query(
      `insert into locations (tenant_id, name) values ($1, 'Unidade') returning id`,
      [tenantId],
    );
    const professional = await pool.query(
      `insert into professionals (tenant_id, location_id, name)
       values ($1, $2, 'Dr. Teste') returning id`,
      [tenantId, location.rows[0].id],
    );
    const service = await pool.query(
      `insert into services (tenant_id, name, duration_minutes, price)
       values ($1, 'Limpeza', 40, 240) returning id`,
      [tenantId],
    );
    const insert = () =>
      pool.query(
        `insert into professional_services (tenant_id, professional_id, service_id)
         values ($1, $2, $3)`,
        [tenantId, professional.rows[0].id, service.rows[0].id],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- migrations.scheduling.spec.ts`
Expected: FAIL because `locations` does not exist.

- [ ] **Step 3: Implement `0008_scheduling_catalog.sql`**

`locations`: `id`, `tenant_id`, `name`, `address`, `timezone` default `'America/Sao_Paulo'`, `status` (`active|inactive`), timestamps, `unique (tenant_id, name)`, `unique (tenant_id, id)`.

`resources`: `id`, `tenant_id`, `location_id`, `name`, `kind` (`chair|room|equipment`), `status`, timestamps, composite FK to `locations (tenant_id, id)`, `unique (tenant_id, location_id, name)`, `unique (tenant_id, id)`.

`professionals`: `id`, `tenant_id`, `clinic_user_id` nullable, `location_id`, `name`, `specialty`, `calendar_ref`, `status`, timestamps, composite FKs to `clinic_users` and `locations`, `unique (tenant_id, id)`.

`professional_working_hours`: `id`, `tenant_id`, `professional_id`, `location_id`, `weekday smallint check between 0 and 6`, `start_time time`, `end_time time`, `valid_from date default current_date`, `valid_to date`, `check (start_time < end_time)`, composite FKs, `unique (tenant_id, professional_id, location_id, weekday, start_time)`.

`professional_time_off`: `id`, `tenant_id`, `professional_id`, `start_at`, `end_at`, `reason`, `check (start_at < end_at)`, composite FK.

`clinic_holidays`: `id`, `tenant_id`, `location_id` nullable, `holiday_date date`, `name`, composite FK to locations, `unique (tenant_id, location_id, holiday_date)`. Also add a partial unique index for `location_id is null` so a global holiday cannot be duplicated.

`services`: `id`, `tenant_id`, `name`, `description`, `keywords text[] not null default '{}'`, `is_evaluation boolean not null default false`, `duration_minutes > 0`, `price numeric(12,2) >= 0`, `price_disclosure_allowed boolean default false`, `direct_booking_allowed boolean default false`, `requires_evaluation boolean default true`, `preparation_instructions text`, `required_documents text[] default '{}'`, `buffer_before_minutes >= 0 default 0`, `buffer_after_minutes >= 0 default 0`, `status`, timestamps, `unique (tenant_id, name)`, `unique (tenant_id, id)`.

`service_variants`: `id`, `tenant_id`, `service_id`, `min_quantity > 0`, `max_quantity >= min_quantity`, `price >= 0`, `duration_minutes > 0`, composite FK, `unique (tenant_id, service_id, min_quantity)`.

`professional_services`: `tenant_id`, `professional_id`, `service_id`, PK `(tenant_id, professional_id, service_id)`, composite FKs.

`service_professional_requirements`: `id`, `tenant_id`, `service_id`, `professional_id`, `role` (`primary|assistant|required`) default `required`, `required boolean default true`, composite FKs, `unique (tenant_id, service_id, professional_id)`.

Add `alter table clinic_users add constraint clinic_users_tenant_id_id_key unique (tenant_id, id);` before the professionals FK.

Also close the Phase 1 deferred minor while the schema is open:

```sql
alter table patient_contacts
  add constraint patient_contacts_patient_tenant_fk
  foreign key (tenant_id, patient_id)
  references patients (tenant_id, id);
```

`patients (tenant_id, id)` already has the unique constraint from `0005_tenant_fks.sql`, and `patient_id` is nullable, so existing rows are unaffected.

`seedScheduling`: insert the fictional dataset from the discovery doc: location `Vila Mariana`, resource `Cadeira 1`, professionals `Chow` and `Caio` linked to the seeded users, working hours as in section 4, services `Avaliação inicial` (`is_evaluation = true`), `Limpeza` (`keywords {'limpeza','profilaxia'}`, direct booking), `Extração de siso` (requires evaluation), `Implante` (requires evaluation), `Aparelho fixo`, plus a joint service `Extração + planejamento ortodôntico` with requirements for both.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- migrations.scheduling.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add scheduling catalog and professional schema"
```

---

### Task 2: Appointment schema and database concurrency guards

**Files:**
- Create: `supabase/migrations/0009_appointments.sql`
- Test: `apps/api/test/migrations.appointments.spec.ts`

**Interfaces:**
- Produces tables `appointments`, `appointment_professionals`, `professional_reservations`, `resource_reservations`, `appointment_operations`, `availability_locks`.
- Produces the invariant: overlapping `BOOKED`/`RESCHEDULE_PENDING` reservations for the same professional or the same resource are rejected by PostgreSQL, even under concurrency.

- [ ] **Step 1: Write the failing test**

```ts
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

const reserveProfessional = (pool: any, ids: any, appointmentId: string, startAt: string, endAt: string, status = 'BOOKED') =>
  pool.query(
    `insert into professional_reservations
       (tenant_id, appointment_id, professional_id, start_at, end_at, status)
     values ($1, $2, $3, $4, $5, $6)`,
    [ids.tenantId, appointmentId, ids.caioId, startAt, endAt, status],
  );

describe('appointment schema', () => {
  it('rejects overlapping professional reservations', async () => {
    const { pool, clinic, scheduling: s } = await fixture();
    const first = await createAppointment(pool, { ...clinic, ...s }, '2026-11-09T12:00:00Z', '2026-11-09T13:00:00Z');
    const second = await createAppointment(pool, { ...clinic, ...s }, '2026-11-09T12:30:00Z', '2026-11-09T13:30:00Z');

    await reserveProfessional(pool, { ...clinic, ...s }, first, '2026-11-09T12:00:00Z', '2026-11-09T13:00:00Z');
    await expect(
      reserveProfessional(pool, { ...clinic, ...s }, second, '2026-11-09T12:30:00Z', '2026-11-09T13:30:00Z'),
    ).rejects.toThrow(/exclusion constraint|conflicting key/);
  });

  it('does not block a released professional reservation', async () => {
    const { pool, clinic, scheduling: s } = await fixture();
    const first = await createAppointment(pool, { ...clinic, ...s }, '2026-11-09T12:00:00Z', '2026-11-09T13:00:00Z');
    const second = await createAppointment(pool, { ...clinic, ...s }, '2026-11-09T12:30:00Z', '2026-11-09T13:30:00Z');

    await reserveProfessional(pool, { ...clinic, ...s }, first, '2026-11-09T12:00:00Z', '2026-11-09T13:00:00Z', 'RELEASED');
    await expect(
      reserveProfessional(pool, { ...clinic, ...s }, second, '2026-11-09T12:30:00Z', '2026-11-09T13:30:00Z'),
    ).resolves.toBeDefined();
  });

  it('rejects overlapping resource reservations on the single chair', async () => {
    const { pool, clinic, scheduling: s } = await fixture();
    const first = await createAppointment(pool, { ...clinic, ...s }, '2026-11-09T12:00:00Z', '2026-11-09T13:00:00Z');
    const second = await createAppointment(pool, { ...clinic, ...s }, '2026-11-09T12:30:00Z', '2026-11-09T13:30:00Z');
    const reserveResource = (appointmentId: string, startAt: string, endAt: string) =>
      pool.query(
        `insert into resource_reservations
           (tenant_id, appointment_id, resource_id, start_at, end_at, status)
         values ($1, $2, $3, $4, $5, 'BOOKED')`,
        [s.tenantId, appointmentId, s.resourceId, startAt, endAt],
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
      createAppointment(pool, { ...clinic, ...s }, '2026-11-09T13:00:00Z', '2026-11-09T12:00:00Z'),
    ).rejects.toThrow(/check constraint/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- migrations.appointments.spec.ts`
Expected: FAIL because `appointments` does not exist.

- [ ] **Step 3: Implement `0009_appointments.sql`**

```sql
create extension if not exists btree_gist;
```

`appointments`: `id`, `tenant_id`, `patient_contact_id`, `patient_id` nullable, `service_id`, `location_id`, `resource_id` nullable, `start_at`, `end_at`, `status` (`BOOKING|BOOKED|RESCHEDULE_PENDING|CANCELLED|COMPLETED|NO_SHOW|UNKNOWN`), `source` (`bot|human|import`), `created_by`, `cancellation_reason`, `attendance_status` (`PENDING|ATTENDED|NO_SHOW|LATE_CANCELLED`), `confirmation_status` (`PENDING|CONFIRMED|DECLINED`), `google_event_id`, `operation_id`, timestamps, `check (end_at > start_at)`, composite FKs to contact/service/location/resource/operation, `unique (tenant_id, id)`.

`appointment_professionals`: `tenant_id`, `appointment_id`, `professional_id`, `role` (`primary|assistant|required`), PK `(tenant_id, appointment_id, professional_id)`, composite FKs.

`professional_reservations`: `id`, `tenant_id`, `appointment_id`, `professional_id`, `start_at`, `end_at`, `status` (`BOOKED|RESCHEDULE_PENDING|RELEASED`), `created_at`, `check (end_at > start_at)`, composite FKs. Add:

```sql
alter table professional_reservations
  add constraint professional_reservations_no_overlap
  exclude using gist (
    professional_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status in ('BOOKED', 'RESCHEDULE_PENDING'));
```

`resource_reservations`: same shape with `resource_id` instead of `professional_id`, and the analogous exclusion constraint.

`appointment_operations`: `id`, `tenant_id`, `idempotency_key`, `operation_type` (`BOOK|RESCHEDULE|CANCEL`), `status` (`PENDING|COMPLETED|FAILED|UNKNOWN`), `request_payload jsonb`, `result_payload jsonb`, `external_reference`, timestamps, `unique (tenant_id, idempotency_key)`, `unique (tenant_id, id)`.

Create `appointment_operations` **before** `appointments` so the operation can be referenced, then add the circular FK after both exist:

```sql
alter table appointments
  add constraint appointments_operation_tenant_fk
  foreign key (tenant_id, operation_id)
  references appointment_operations (tenant_id, id);
```

`availability_locks`: `id`, `tenant_id`, `professional_id`, `start_at`, `end_at`, `expires_at`, `operation_id` nullable, `status` (`ACTIVE|RELEASED|EXPIRED`), `created_at`, `check (end_at > start_at)`, composite FKs, partial index `(tenant_id, professional_id, expires_at) where status = 'ACTIVE'`.

**Why resource reservations are a separate table:** a joint appointment has two professional reservations but only one chair. Putting the exclusion constraint on `professional_reservations` would make the two rows conflict with each other. The chair guard therefore lives in `resource_reservations`, one row per appointment.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- migrations.appointments.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add appointment schema with professional and resource exclusion guards"
```

---

### Task 3: Scheduling repositories and fixture

**Files:**
- Create: `apps/api/src/db/repositories/catalog.repository.ts`
- Create: `apps/api/src/db/repositories/appointments.repository.ts`
- Create: `apps/api/src/db/repositories/operations.repository.ts`
- Create: `apps/api/src/db/repositories/locks.repository.ts`
- Modify: `apps/api/src/db/repositories/rows.ts` (scheduling row types)
- Modify: `apps/api/test/helpers/db.ts` (finish `seedScheduling` from Task 1)
- Test: `apps/api/test/catalog.repository.spec.ts`

**Interfaces:**
- `CatalogRepository.findService(tenantId, serviceId): Promise<Service | null>`
- `CatalogRepository.findVariant(tenantId, serviceId, quantity): Promise<ServiceVariant | null>`
- `CatalogRepository.listProfessionalsForService(tenantId, serviceId): Promise<Professional[]>`
- `CatalogRepository.listRequirements(tenantId, serviceId): Promise<ServiceProfessionalRequirement[]>`
- `CatalogRepository.listWorkingHours(tenantId, professionalIds, from, to): Promise<ProfessionalWorkingHour[]>`
- `CatalogRepository.listTimeOff(tenantId, professionalIds, from, to): Promise<ProfessionalTimeOff[]>`
- `CatalogRepository.listHolidays(tenantId, locationId, from, to): Promise<ClinicHoliday[]>`
- `CatalogRepository.listReservations(tenantId, professionalIds, from, to): Promise<ProfessionalReservation[]>`
- `CatalogRepository.listResourceReservations(tenantId, resourceId, from, to): Promise<ResourceReservation[]>`
- `CatalogRepository.listActiveLocks(tenantId, professionalIds, from, to, now): Promise<AvailabilityLock[]>`
- `AppointmentsRepository.createWithReservations(input): Promise<Appointment>` — one transaction inserting the appointment, professionals, professional reservations and resource reservation; any conflict rolls everything back.
- `AppointmentsRepository.findById(tenantId, appointmentId): Promise<Appointment | null>`
- `AppointmentsRepository.updateStatus(tenantId, appointmentId, status): Promise<void>`
- `AppointmentsRepository.releaseReservations(tenantId, appointmentId): Promise<void>`
- `OperationsRepository.createOrGet(input): Promise<{ operation: AppointmentOperation; created: boolean }>`
- `OperationsRepository.mark(tenantId, id, status, resultPayload?, externalReference?): Promise<void>`
- `LocksRepository.create(input): Promise<AvailabilityLock>`, `release(tenantId, id)`, `releaseExpired(now)`, `findActive(tenantId, professionalId, startAt, endAt, now)`.

- [ ] **Step 1: Write the failing test**

```ts
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
      professionalIds: [{ id: s.caioId, role: 'primary' as const }],
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- catalog.repository.spec.ts`
Expected: FAIL because `CatalogRepository` does not exist.

- [ ] **Step 3: Implement the repositories**

All SELECTs filter `tenant_id`; all inserts take it explicitly. Use SQL aliases to camelCase (`tenant_id as "tenantId"`). `AppointmentsRepository` takes a `Pool` (not `Queryable`) because it uses `withTransaction`. `createWithReservations` inserts the appointment as `BOOKING`, then `appointment_professionals`, then one `professional_reservations` row per professional with `status = 'BOOKED'`, then the `resource_reservations` row. A conflict anywhere rolls back the whole transaction.

`OperationsRepository.createOrGet` uses `INSERT ... ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING *`; when no row is returned, select the existing one and return `created: false`. `mark` updates status/result/external reference and `updated_at`.

`LocksRepository.releaseExpired` updates `status = 'EXPIRED'` where `expires_at <= $now and status = 'ACTIVE'`; it does not delete rows.

Add the scheduling row types to `rows.ts`: `Service`, `ServiceVariant`, `Professional`, `ServiceProfessionalRequirement`, `ProfessionalWorkingHour`, `ProfessionalTimeOff`, `ClinicHoliday`, `ProfessionalReservation`, `ResourceReservation`, `AvailabilityLock`, `Appointment`, `AppointmentOperation`.

`seedScheduling` uses idempotent inserts (`on conflict do nothing`) and returns the ids. It seeds the fictional data from the discovery doc: one location, one chair, Chow/Caio, working hours, services and joint requirements.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- catalog.repository.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add scheduling repositories and catalog fixture"
```

---

### Task 4: Deterministic slot engine

**Files:**
- Create: `apps/api/src/scheduling/types.ts`
- Create: `apps/api/src/scheduling/slot-engine.ts`
- Modify: `apps/api/package.json` (add `luxon`, `@types/luxon`)
- Test: `apps/api/test/slot-engine.spec.ts`

**Interfaces:**
- Produces `SlotRequest = { tenantId; serviceId; quantity; professionalId: string | null; locationId; from: Date; to: Date; now: Date }`.
- Produces `Slot = { startAt: Date; endAt: Date; professionalIds: string[]; resourceId: string | null }`.
- Produces `SlotEngine.findSlots(input: SlotEngineInput): Slot[]` where `SlotEngineInput` contains the loaded service, variant, qualified professionals, requirements, working hours, time off, holidays, professional reservations, resource reservations, active locks, resources, timezone, granularity, minimum advance and maximum horizon.
- Produces `BlockingInterval` helpers in `types.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { SlotEngine } from '../src/scheduling/slot-engine';

const service = {
  id: 'svc-cleaning',
  name: 'Limpeza',
  keywords: ['limpeza', 'profilaxia'],
  isEvaluation: false,
  durationMinutes: 40,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 10,
  directBookingAllowed: true,
  requiresEvaluation: false,
};

const caio = { id: 'prof-caio', name: 'Dr. Caio', status: 'active' };
const chow = { id: 'prof-chow', name: 'Dr. Chow', status: 'active' };

const mondayHours = (professionalId: string) => [
  { professionalId, weekday: 1, startTime: '09:00', endTime: '12:00' },
  { professionalId, weekday: 1, startTime: '13:00', endTime: '18:00' },
];

const baseInput = (overrides: Record<string, unknown> = {}) => ({
  request: {
    tenantId: 't',
    serviceId: service.id,
    quantity: 1,
    professionalId: caio.id,
    locationId: 'loc',
    from: new Date('2026-11-09T00:00:00-03:00'),
    to: new Date('2026-11-09T23:59:59-03:00'),
    now: new Date('2026-11-08T12:00:00-03:00'),
  },
  service,
  variant: null,
  qualifiedProfessionals: [caio],
  requirements: [],
  workingHours: mondayHours(caio.id),
  timeOff: [],
  holidays: [],
  reservations: [],
  resourceReservations: [],
  locks: [],
  resources: [{ id: 'chair-1', status: 'active' }],
  timezone: 'America/Sao_Paulo',
  granularityMinutes: 15,
  minAdvanceMinutes: 60,
  maxHorizonDays: 90,
  ...overrides,
});

describe('SlotEngine.findSlots', () => {
  it('generates slots inside working hours with the after-buffer', () => {
    const slots = new SlotEngine().findSlots(baseInput());
    expect(slots[0].startAt.toISOString()).toBe('2026-11-09T12:00:00.000Z'); // 09:00 BRT
    expect(slots.at(-1)!.startAt.toISOString()).toBe('2026-11-09T14:10:00.000Z'); // 11:10 BRT
    expect(slots.every((slot) => slot.professionalIds.includes(caio.id))).toBe(true);
  });

  it('excludes lunch and time off', () => {
    const slots = new SlotEngine().findSlots(
      baseInput({
        workingHours: mondayHours(caio.id),
        timeOff: [
          {
            professionalId: caio.id,
            startAt: new Date('2026-11-09T15:00:00Z'),
            endAt: new Date('2026-11-09T16:00:00Z'),
          },
        ],
      }),
    );
    expect(
      slots.some(
        (slot) =>
          slot.startAt.getTime() >= new Date('2026-11-09T12:00:00Z').getTime() &&
          slot.startAt.getTime() < new Date('2026-11-09T13:00:00Z').getTime(),
      ),
    ).toBe(false);
    expect(
      slots.some(
        (slot) =>
          slot.startAt.getTime() >= new Date('2026-11-09T15:00:00Z').getTime() &&
          slot.startAt.getTime() < new Date('2026-11-09T16:00:00Z').getTime(),
      ),
    ).toBe(false);
  });

  it('excludes holidays', () => {
    const slots = new SlotEngine().findSlots(
      baseInput({ holidays: [{ locationId: 'loc', date: '2026-11-09' }] }),
    );
    expect(slots).toHaveLength(0);
  });

  it('excludes existing reservations and active locks, but not expired locks', () => {
    const reserved = new SlotEngine().findSlots(
      baseInput({
        reservations: [
          {
            professionalId: caio.id,
            startAt: new Date('2026-11-09T12:00:00Z'),
            endAt: new Date('2026-11-09T12:40:00Z'),
            status: 'BOOKED',
          },
        ],
      }),
    );
    expect(reserved.some((slot) => slot.startAt.toISOString() === '2026-11-09T12:00:00.000Z')).toBe(false);

    const locked = new SlotEngine().findSlots(
      baseInput({
        locks: [
          {
            professionalId: caio.id,
            startAt: new Date('2026-11-09T12:00:00Z'),
            endAt: new Date('2026-11-09T12:40:00Z'),
            expiresAt: new Date('2026-11-09T12:05:00Z'),
            status: 'ACTIVE',
          },
        ],
        request: { ...baseInput().request, now: new Date('2026-11-09T12:00:00Z') },
      }),
    );
    expect(locked).toHaveLength(0);
  });

  it('requires every professional for a joint service', () => {
    const requirements = [
      { professionalId: chow.id, required: true },
      { professionalId: caio.id, required: true },
    ];
    const bothFree = new SlotEngine().findSlots(
      baseInput({
        request: { ...baseInput().request, professionalId: null },
        service: { ...service, durationMinutes: 60, bufferAfterMinutes: 10 },
        qualifiedProfessionals: [chow, caio],
        requirements,
        workingHours: [
          { professionalId: chow.id, weekday: 1, startTime: '14:00', endTime: '18:00' },
          { professionalId: caio.id, weekday: 1, startTime: '14:00', endTime: '18:00' },
        ],
      }),
    );
    expect(bothFree.length).toBeGreaterThan(0);
    expect(bothFree[0].professionalIds.sort()).toEqual([caio.id, chow.id].sort());

    const oneBusy = new SlotEngine().findSlots(
      baseInput({
        request: { ...baseInput().request, professionalId: null },
        service: { ...service, durationMinutes: 60, bufferAfterMinutes: 10 },
        qualifiedProfessionals: [chow, caio],
        requirements,
        workingHours: [
          { professionalId: chow.id, weekday: 1, startTime: '14:00', endTime: '18:00' },
          { professionalId: caio.id, weekday: 1, startTime: '14:00', endTime: '18:00' },
        ],
        reservations: [
          {
            professionalId: caio.id,
            startAt: new Date('2026-11-09T17:00:00Z'),
            endAt: new Date('2026-11-09T18:00:00Z'),
            status: 'BOOKED',
          },
        ],
      }),
    );
    expect(oneBusy.every((slot) => slot.startAt.toISOString() !== '2026-11-09T17:00:00.000Z')).toBe(true);
  });

  it('does not offer a slot when the chair is reserved', () => {
    const slots = new SlotEngine().findSlots(
      baseInput({
        resourceReservations: [
          {
            resourceId: 'chair-1',
            startAt: new Date('2026-11-09T12:00:00Z'),
            endAt: new Date('2026-11-09T18:00:00Z'),
            status: 'BOOKED',
          },
        ],
      }),
    );
    expect(slots).toHaveLength(0);
  });

  it('respects minimum advance and maximum horizon', () => {
    const tooSoon = new SlotEngine().findSlots(
      baseInput({
        request: { ...baseInput().request, now: new Date('2026-11-09T11:30:00Z') },
      }),
    );
    expect(tooSoon.length).toBeGreaterThan(0);
    expect(tooSoon[0].startAt.getTime()).toBeGreaterThanOrEqual(
      new Date('2026-11-09T12:30:00Z').getTime(),
    );

    const beyondHorizon = new SlotEngine().findSlots(
      baseInput({
        request: {
          ...baseInput().request,
          from: new Date('2026-11-10T00:00:00-03:00'),
          to: new Date('2026-11-10T23:59:59-03:00'),
        },
        workingHours: [{ professionalId: caio.id, weekday: 2, startTime: '09:00', endTime: '12:00' }],
        maxHorizonDays: 0,
      }),
    );
    expect(beyondHorizon).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm install luxon && npm install -D @types/luxon && npm test -- slot-engine.spec.ts`
Expected: FAIL because `slot-engine.ts` does not exist.

- [ ] **Step 3: Implement the engine**

Use `DateTime.fromJSDate(value, { zone: input.timezone })`. For each day between `from` and `to`, build working intervals from `workingHours` matching the weekday and validity, subtract `timeOff`, and intersect the intervals of all required professionals. Subtract `reservations`, `resourceReservations` and active `locks`, expanded by the service buffers. Generate starts at `granularityMinutes`, keeping `start >= now + minAdvanceMinutes` and `start + duration <= now + maxHorizonDays`. A slot is valid only when the full blocking interval (buffer before + duration + buffer after) fits inside the free intersection and the chair is free.

Required professionals: a requested `professionalId` wins; otherwise, required `service_professional_requirements`; otherwise, every qualified professional. If a requested professional is not qualified for the service, return `[]`. If the service has requirements and a required professional is missing from the qualified list, return `[]`.

Return slots sorted by `startAt`, deduplicated by `startAt + professionalIds`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- slot-engine.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add deterministic scheduling slot engine"
```

---

### Task 5: Availability service over the real database

**Files:**
- Create: `apps/api/src/scheduling/availability.service.ts`
- Test: `apps/api/test/availability.service.spec.ts`

**Interfaces:**
- `AvailabilityService.findSlots(request: SlotRequest): Promise<Slot[]>`
- Throws `DomainError('SERVICE_NOT_FOUND', 404)` when the service does not belong to the tenant.
- Uses the location timezone, granularity `15`, minimum advance `120` minutes and maximum horizon `90` days from configuration (constants in `scheduling/types.ts` for the pilot).

- [ ] **Step 1: Write the failing test**

```ts
import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { CatalogRepository } from '../src/db/repositories/catalog.repository';
import { AvailabilityService } from '../src/scheduling/availability.service';
import { SlotEngine } from '../src/scheduling/slot-engine';

const build = (pool: any) =>
  new AvailabilityService(new CatalogRepository(pool), new SlotEngine(), {
    granularityMinutes: 15,
    minAdvanceMinutes: 120,
    maxHorizonDays: 90,
  });

describe('AvailabilityService', () => {
  it('returns slots for a Monday cleaning with the seeded schedule', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool);
    const s = await seedScheduling(pool, clinic.tenantId);
    const slots = await build(pool).findSlots({
      tenantId: clinic.tenantId,
      serviceId: s.cleaningServiceId,
      quantity: 1,
      professionalId: s.caioId,
      locationId: s.locationId,
      from: new Date('2026-11-09T00:00:00-03:00'),
      to: new Date('2026-11-09T23:59:59-03:00'),
      now: new Date('2026-11-08T12:00:00-03:00'),
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].professionalIds).toContain(s.caioId);
  });

  it('returns no slots for a different tenant', async () => {
    const pool = getTestPool();
    const a = await seedClinic(pool, { suffix: 'a' });
    const b = await seedClinic(pool, { suffix: 'b' });
    const s = await seedScheduling(pool, a.tenantId);
    await expect(
      build(pool).findSlots({
        tenantId: b.tenantId,
        serviceId: s.cleaningServiceId,
        quantity: 1,
        professionalId: null,
        locationId: s.locationId,
        from: new Date('2026-11-09T00:00:00-03:00'),
        to: new Date('2026-11-09T23:59:59-03:00'),
        now: new Date('2026-11-08T12:00:00-03:00'),
      }),
    ).rejects.toThrow(/SERVICE_NOT_FOUND/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- availability.service.spec.ts`
Expected: FAIL because `AvailabilityService` does not exist.

- [ ] **Step 3: Implement the service**

Load the service, variant, qualified professionals, requirements, working hours, time off, holidays, professional reservations, resource reservations, active locks and the active resources for the location. Call `SlotEngine.findSlots`. If the service is missing, throw `DomainError('SERVICE_NOT_FOUND', 404, 'Service not found')`. If no resources exist, pass an empty list and let the engine skip the resource check (configurable; the pilot always has one chair).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- availability.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add availability service over the internal agenda"
```

---

### Task 6: Calendar adapter boundary and fake

**Files:**
- Create: `apps/api/src/calendar/calendar-adapter.ts`
- Create: `apps/api/src/calendar/fake-calendar.adapter.ts`
- Test: `apps/api/test/fake-calendar.adapter.spec.ts`

**Interfaces:**
- `CalendarEvent = { operationId; tenantId; summary; startAt; endAt; professionalId }`
- `CalendarAdapter = { createEvent(event): Promise<{ externalEventId }>; getEvent(externalEventId): Promise<{ exists; startAt?; endAt? }>; cancelEvent(externalEventId): Promise<void> }`
- `FakeCalendarAdapter` exposes `events`, `failNextCreate`, `createThenThrow`, and `cancelled`.

- [ ] **Step 1: Write the failing test**

```ts
import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';

const event = {
  operationId: 'op-1',
  tenantId: 't',
  summary: 'Limpeza — Maria',
  startAt: new Date('2026-11-09T12:00:00Z'),
  endAt: new Date('2026-11-09T12:40:00Z'),
  professionalId: 'prof-caio',
};

describe('FakeCalendarAdapter', () => {
  it('creates, reads and cancels an event with a deterministic id', async () => {
    const calendar = new FakeCalendarAdapter();
    const created = await calendar.createEvent(event);
    expect(created.externalEventId).toBe('fake-op-1');
    expect(await calendar.getEvent(created.externalEventId)).toMatchObject({ exists: true });

    await calendar.cancelEvent(created.externalEventId);
    expect(await calendar.getEvent(created.externalEventId)).toEqual({ exists: false });
  });

  it('can simulate a timeout after the event was created', async () => {
    const calendar = new FakeCalendarAdapter();
    calendar.createThenThrow = new Error('ETIMEDOUT');

    await expect(calendar.createEvent(event)).rejects.toThrow(/ETIMEDOUT/);
    expect(await calendar.getEvent('fake-op-1')).toMatchObject({ exists: true });
  });

  it('can simulate a failure before the event was created', async () => {
    const calendar = new FakeCalendarAdapter();
    calendar.failNextCreate = new Error('calendar down');

    await expect(calendar.createEvent(event)).rejects.toThrow(/calendar down/);
    expect(await calendar.getEvent('fake-op-1')).toEqual({ exists: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- fake-calendar.adapter.spec.ts`
Expected: FAIL because `FakeCalendarAdapter` does not exist.

- [ ] **Step 3: Implement the fake and the interface**

The deterministic id is `fake-${operationId}`. `createThenThrow` stores the event first, then throws, simulating a timeout where the remote side succeeded. `failNextCreate` throws before storing and clears itself. `cancelEvent` removes the event and records the id in `cancelled`. `getEvent` returns `{ exists: false }` for unknown ids.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- fake-calendar.adapter.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add calendar adapter boundary and deterministic fake"
```

---

### Task 7: Idempotent booking core

**Files:**
- Create: `apps/api/src/scheduling/booking.service.ts`
- Test: `apps/api/test/booking.service.spec.ts`

**Interfaces:**
- `BookInput = { tenantId; conversationId; patientContactId; serviceId; quantity; professionalIds: string[]; startAt: Date; idempotencyKey: string }`
- `BookingOutcome = { status: 'BOOKED'; appointment: Appointment } | { status: 'CONFLICT'; alternatives: Slot[] } | { status: 'UNKNOWN'; appointmentId: string; operationId: string }`
- `BookingService.book(input): Promise<BookingOutcome>`
- `BookingService` dependencies: `CatalogRepository`, `AvailabilityService`, `AppointmentsRepository`, `OperationsRepository`, `LocksRepository`, `CalendarAdapter`, and a clock (`() => Date` for tests).

- [ ] **Step 1: Write the failing tests**

```ts
import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { CatalogRepository } from '../src/db/repositories/catalog.repository';
import { AppointmentsRepository } from '../src/db/repositories/appointments.repository';
import { OperationsRepository } from '../src/db/repositories/operations.repository';
import { LocksRepository } from '../src/db/repositories/locks.repository';
import { AvailabilityService } from '../src/scheduling/availability.service';
import { SlotEngine } from '../src/scheduling/slot-engine';
import { BookingService } from '../src/scheduling/booking.service';
import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';

const build = (pool: any, calendar = new FakeCalendarAdapter()) =>
  new BookingService({
    catalog: new CatalogRepository(pool),
    availability: new AvailabilityService(new CatalogRepository(pool), new SlotEngine(), {
      granularityMinutes: 15,
      minAdvanceMinutes: 0,
      maxHorizonDays: 90,
    }),
    appointments: new AppointmentsRepository(pool),
    operations: new OperationsRepository(pool),
    locks: new LocksRepository(pool),
    calendar,
    now: () => new Date('2026-11-09T09:00:00Z'),
  });

const input = (clinic: any, s: any, overrides: Record<string, unknown> = {}) => ({
  tenantId: clinic.tenantId,
  conversationId: clinic.conversationId!,
  patientContactId: clinic.contactId!,
  serviceId: s.cleaningServiceId,
  quantity: 1,
  professionalIds: [s.caioId],
  startAt: new Date('2026-11-09T12:00:00Z'),
  idempotencyKey: 'book-1',
  ...overrides,
});

describe('BookingService.book', () => {
  it('books a free slot, creates reservations and completes the operation', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    const service = build(pool, calendar);

    const result = await service.book(input(clinic, s));
    expect(result.status).toBe('BOOKED');
    if (result.status !== 'BOOKED') return;

    expect(result.appointment.status).toBe('BOOKED');
    expect(calendar.events.size).toBe(1);
    const reservations = await pool.query(
      `select status from professional_reservations where appointment_id = $1`,
      [result.appointment.id],
    );
    expect(reservations.rows).toEqual([{ status: 'BOOKED' }]);
  });

  it('returns the same appointment for a repeated idempotency key', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const service = build(pool);

    const first = await service.book(input(clinic, s));
    const second = await service.book(input(clinic, s));
    expect(second.status).toBe('BOOKED');
    if (first.status !== 'BOOKED' || second.status !== 'BOOKED') return;
    expect(second.appointment.id).toBe(first.appointment.id);
  });

  it('returns CONFLICT when the slot is already reserved', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const service = build(pool);

    await service.book(input(clinic, s, { idempotencyKey: 'book-1' }));
    const second = await service.book(input(clinic, s, { idempotencyKey: 'book-2' }));
    expect(second.status).toBe('CONFLICT');
  });

  it('marks the appointment UNKNOWN when the calendar times out after creating the event', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    const s = await seedScheduling(pool, clinic.tenantId);
    const calendar = new FakeCalendarAdapter();
    calendar.createThenThrow = new Error('ETIMEDOUT');
    const service = build(pool, calendar);

    const result = await service.book(input(clinic, s));
    expect(result.status).toBe('UNKNOWN');
    if (result.status !== 'UNKNOWN') return;

    const appointment = await pool.query(`select status from appointments where id = $1`, [
      result.appointmentId,
    ]);
    expect(appointment.rows[0].status).toBe('UNKNOWN');
    const operation = await pool.query(
      `select status from appointment_operations where id = $1`,
      [result.operationId],
    );
    expect(operation.rows[0].status).toBe('UNKNOWN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- booking.service.spec.ts`
Expected: FAIL because `BookingService` does not exist.

- [ ] **Step 3: Implement the booking flow**

1. `operations.createOrGet({ operationType: 'BOOK', idempotencyKey })`. If it already exists with `COMPLETED`, load the appointment from `result_payload.appointmentId` and return `BOOKED`. If `UNKNOWN`, return `UNKNOWN` with the stored appointment id. If `PENDING`, continue.
2. Load the service and variant; compute `durationMinutes`, `bufferBeforeMinutes`, `bufferAfterMinutes`, `startAt`, `endAt`, `blockingStartAt`, `blockingEndAt`.
3. Revalidate with `availability.findSlots` for the day. The exact `startAt` and the professional set must be present; otherwise mark the operation `FAILED`, release locks, and return `CONFLICT` with the next three alternatives.
4. Create `availability_locks` for each professional with `expires_at = now + 5 minutes` and the operation id.
5. `appointments.createWithReservations(...)`. On an exclusion/unique conflict, release locks, mark `FAILED`, and return `CONFLICT` with alternatives.
6. `calendar.createEvent` with `operationId`. On success, `calendar.getEvent` and verify `exists`. Then update the appointment to `BOOKED`, mark the operation `COMPLETED` with `{ appointmentId }` and `externalReference = eventId`, release locks, return `BOOKED`.
7. On calendar error (including timeout): update the appointment to `UNKNOWN`, mark the operation `UNKNOWN` with `{ appointmentId }`, leave the professional and resource reservations `BOOKED` (the slot stays blocked), release locks, return `UNKNOWN`. Reconciliation will decide.

Idempotency rule: the same key always returns the same outcome; a `COMPLETED` operation never creates a second appointment or event.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- booking.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add idempotent booking core with calendar verification"
```

---

### Task 8: Concurrency, timeout reconciliation and expired locks

**Files:**
- Create: `apps/api/src/scheduling/reconciliation.service.ts`
- Create: `apps/api/src/cli/reconcile.ts`
- Test: `apps/api/test/booking.concurrency.spec.ts`
- Test: `apps/api/test/booking.timeout.spec.ts`
- Test: `apps/api/test/reconciliation.service.spec.ts`

**Interfaces:**
- `ReconciliationService.reconcileUnknown(tenantId: string): Promise<{ confirmed: number; failed: number }>`
- `ReconciliationService.releaseExpiredLocks(now: Date): Promise<number>`
- `npm run reconcile` runs reconciliation for every tenant with `UNKNOWN` operations and prints a summary.

- [ ] **Step 1: Write the failing tests**

```ts
// booking.concurrency.spec.ts (core assertion)
const [a, b] = await Promise.all([
  service.book(input(clinic, s, { idempotencyKey: 'race-1' })),
  service.book(input(clinic, s, { idempotencyKey: 'race-2' })),
]);
const outcomes = [a, b].map((result) => result.status).sort();
expect(outcomes).toEqual(['BOOKED', 'CONFLICT']);
const count = await pool.query(
  `select count(*)::int as n from appointments where tenant_id = $1 and status = 'BOOKED'`,
  [clinic.tenantId],
);
expect(count.rows[0].n).toBe(1);
```

```ts
// booking.timeout.spec.ts — event exists, response was lost
calendar.createThenThrow = new Error('ETIMEDOUT');
const result = await service.book(input(clinic, s));
expect(result.status).toBe('UNKNOWN');

const reconciliation = new ReconciliationService({ /* same repos */, calendar });
const summary = await reconciliation.reconcileUnknown(clinic.tenantId);
expect(summary.confirmed).toBe(1);

const appointment = await pool.query(`select status, google_event_id from appointments where id = $1`, [
  (result as any).appointmentId,
]);
expect(appointment.rows[0].status).toBe('BOOKED');
expect(appointment.rows[0].google_event_id).toBeTruthy();
```

```ts
// booking.timeout.spec.ts — event was never created
calendar.failNextCreate = new Error('calendar down');
const result = await service.book(input(clinic, s));
expect(result.status).toBe('UNKNOWN');

const summary = await reconciliation.reconcileUnknown(clinic.tenantId);
expect(summary.failed).toBe(1);
const appointment = await pool.query(`select status from appointments where id = $1`, [
  (result as any).appointmentId,
]);
expect(appointment.rows[0].status).toBe('CANCELLED');
const reservations = await pool.query(
  `select status from professional_reservations where appointment_id = $1`,
  [(result as any).appointmentId],
);
expect(reservations.rows).toEqual([{ status: 'RELEASED' }]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- booking.concurrency.spec.ts booking.timeout.spec.ts reconciliation.service.spec.ts`
Expected: FAIL because `ReconciliationService` does not exist and/or the race produces two bookings.

- [ ] **Step 3: Implement the reconciliation**

`reconcileUnknown` lists operations with status `UNKNOWN`. For `BOOK`:
- Compute the deterministic calendar id from `operationId`.
- `calendar.getEvent(id)`.
- If it exists: update the appointment to `BOOKED`, persist `google_event_id`, keep reservations, mark the operation `COMPLETED`.
- If it does not exist: update the appointment to `CANCELLED`, release professional and resource reservations, mark the operation `FAILED`.

For `CANCEL`:
- If the event exists, `cancelEvent`; mark the appointment `CANCELLED`, release reservations, mark the operation `COMPLETED`.
- If it does not exist, treat as already cancelled and do the same.

For `RESCHEDULE`:
- `result_payload` stores `newAppointmentId` and `oldAppointmentId`.
- If the new event exists: verify; cancel the old event if it exists; mark the old appointment `CANCELLED` and release its reservations; mark the new `BOOKED`; mark the operation `COMPLETED`.
- If the new event does not exist: cancel the new appointment and release its reservations; keep the old `BOOKED`; mark the operation `FAILED`.

`releaseExpiredLocks` marks `ACTIVE` locks with `expires_at <= now` as `EXPIRED`.

`src/cli/reconcile.ts` connects with `loadEnv`, calls `releaseExpiredLocks(new Date())`, then `reconcileUnknown` for each tenant with unknown operations, and prints the summary. `package.json` adds `"reconcile": "tsx src/cli/reconcile.ts"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npm test -- booking.concurrency.spec.ts booking.timeout.spec.ts reconciliation.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add concurrency tests and UNKNOWN reconciliation"
```

---

### Task 9: Reschedule — new reservation before cancelling the old one

**Files:**
- Modify: `apps/api/src/scheduling/booking.service.ts` (add `reschedule`)
- Modify: `apps/api/src/calendar/fake-calendar.adapter.ts` (add `failNextCancel`, `cancelThenThrow`)
- Test: `apps/api/test/reschedule.service.spec.ts`

**Interfaces:**
- `RescheduleInput = { tenantId; appointmentId; newStartAt: Date; professionalIds: string[]; idempotencyKey: string }`
- `BookingService.reschedule(input): Promise<BookingOutcome>`
- The old appointment remains `BOOKED` until the new reservation and event are verified.

- [ ] **Step 1: Write the failing tests**

```ts
it('creates the new booking first, then cancels the old one', async () => {
  const old = await service.book(input(clinic, s, { idempotencyKey: 'old' }));
  if (old.status !== 'BOOKED') throw new Error('setup failed');

  const result = await service.reschedule({
    tenantId: clinic.tenantId,
    appointmentId: old.appointment.id,
    newStartAt: new Date('2026-11-09T13:00:00Z'),
    professionalIds: [s.caioId],
    idempotencyKey: 'resched-1',
  });
  expect(result.status).toBe('BOOKED');

  const oldRow = await pool.query(`select status from appointments where id = $1`, [
    old.appointment.id,
  ]);
  expect(oldRow.rows[0].status).toBe('CANCELLED');
  const oldReservations = await pool.query(
    `select status from professional_reservations where appointment_id = $1`,
    [old.appointment.id],
  );
  expect(oldReservations.rows).toEqual([{ status: 'RELEASED' }]);
  const oldEvent = await pool.query(`select google_event_id from appointments where id = $1`, [
    old.appointment.id,
  ]);
  expect(calendar.cancelled).toContain(oldEvent.rows[0].google_event_id);
});

it('keeps the old appointment when the new slot is taken', async () => {
  const old = await service.book(input(clinic, s, { idempotencyKey: 'old' }));
  const other = await service.book(
    input(clinic, s, { idempotencyKey: 'other', startAt: new Date('2026-11-09T13:00:00Z') }),
  );
  if (old.status !== 'BOOKED' || other.status !== 'BOOKED') throw new Error('setup failed');

  const result = await service.reschedule({
    tenantId: clinic.tenantId,
    appointmentId: old.appointment.id,
    newStartAt: new Date('2026-11-09T13:00:00Z'),
    professionalIds: [s.caioId],
    idempotencyKey: 'resched-conflict',
  });
  expect(result.status).toBe('CONFLICT');

  const oldRow = await pool.query(`select status from appointments where id = $1`, [
    old.appointment.id,
  ]);
  expect(oldRow.rows[0].status).toBe('BOOKED');
});

it('marks UNKNOWN when the old event cannot be cancelled after the new one is confirmed', async () => {
  const old = await service.book(input(clinic, s, { idempotencyKey: 'old' }));
  if (old.status !== 'BOOKED') throw new Error('setup failed');
  calendar.failNextCancel = new Error('cancel down');

  const result = await service.reschedule({
    tenantId: clinic.tenantId,
    appointmentId: old.appointment.id,
    newStartAt: new Date('2026-11-09T13:00:00Z'),
    professionalIds: [s.caioId],
    idempotencyKey: 'resched-unknown',
  });
  expect(result.status).toBe('UNKNOWN');

  const oldRow = await pool.query(`select status from appointments where id = $1`, [
    old.appointment.id,
  ]);
  expect(oldRow.rows[0].status).toBe('BOOKED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- reschedule.service.spec.ts`
Expected: FAIL because `reschedule` does not exist.

- [ ] **Step 3: Implement `reschedule`**

1. Load the old appointment and verify `tenantId` and `status = 'BOOKED'`.
2. `operations.createOrGet({ operationType: 'RESCHEDULE', idempotencyKey })`. If `COMPLETED`, load the new appointment from `result_payload.newAppointmentId` and return `BOOKED`.
3. Revalidate the new slot. If unavailable, mark `FAILED` and return `CONFLICT` with alternatives. The old appointment is untouched.
4. Create the new appointment with status `RESCHEDULE_PENDING`, professional reservations `RESCHEDULE_PENDING`, and the resource reservation `RESCHEDULE_PENDING` in one transaction. The exclusion constraint blocks the new slot if taken.
5. Create the new calendar event and verify it.
6. Cancel the old calendar event and verify it is gone.
7. Mark the old appointment `CANCELLED`, release its reservations, mark the new appointment `BOOKED` and its reservations `BOOKED`, and mark the operation `COMPLETED` with both ids.
8. If step 4 or 5 fails: cancel the new appointment, release its reservations, keep the old `BOOKED`, mark the operation `FAILED`, return `CONFLICT` or `UNKNOWN`.
9. If step 6 fails after step 5 succeeded: mark the new appointment `BOOKED`, keep the old `BOOKED`, mark the operation `UNKNOWN` with both ids, return `UNKNOWN`. Reconciliation will cancel the old event and release its reservations.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- reschedule.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: reschedule with new reservation before old cancellation"
```

---

### Task 10: Cancellation with policy and explicit state

**Files:**
- Modify: `apps/api/src/scheduling/booking.service.ts` (add `cancel`)
- Test: `apps/api/test/cancel.service.spec.ts`

**Interfaces:**
- `CancelInput = { tenantId; appointmentId; idempotencyKey; reason?: string; now?: Date }`
- `CancelOutcome = { status: 'CANCELLED'; appointment: Appointment } | { status: 'UNKNOWN'; appointmentId: string; operationId: string }`
- Cancellations less than 24 hours before the start set `attendance_status = 'LATE_CANCELLED'`; the appointment status is still `CANCELLED`.

- [ ] **Step 1: Write the failing tests**

```ts
it('cancels a booked appointment, releases reservations and cancels the event', async () => {
  const booked = await service.book(input(clinic, s));
  if (booked.status !== 'BOOKED') throw new Error('setup failed');

  const result = await service.cancel({
    tenantId: clinic.tenantId,
    appointmentId: booked.appointment.id,
    idempotencyKey: 'cancel-1',
    now: new Date('2026-11-08T09:00:00Z'),
  });
  expect(result.status).toBe('CANCELLED');
  const row = await pool.query(
    `select status, attendance_status from appointments where id = $1`,
    [booked.appointment.id],
  );
  expect(row.rows[0]).toEqual({ status: 'CANCELLED', attendance_status: 'PENDING' });
  const reservations = await pool.query(
    `select status from professional_reservations where appointment_id = $1`,
    [booked.appointment.id],
  );
  expect(reservations.rows).toEqual([{ status: 'RELEASED' }]);
});

it('marks a cancellation inside 24 hours as late', async () => {
  const booked = await service.book(input(clinic, s));
  if (booked.status !== 'BOOKED') throw new Error('setup failed');

  const result = await service.cancel({
    tenantId: clinic.tenantId,
    appointmentId: booked.appointment.id,
    idempotencyKey: 'cancel-late',
    now: new Date('2026-11-09T09:00:00Z'),
  });
  expect(result.status).toBe('CANCELLED');
  const row = await pool.query(`select attendance_status from appointments where id = $1`, [
    booked.appointment.id,
  ]);
  expect(row.rows[0].attendance_status).toBe('LATE_CANCELLED');
});

it('is idempotent for a repeated cancel', async () => {
  const booked = await service.book(input(clinic, s));
  if (booked.status !== 'BOOKED') throw new Error('setup failed');

  await service.cancel({
    tenantId: clinic.tenantId,
    appointmentId: booked.appointment.id,
    idempotencyKey: 'cancel-1',
    now: new Date('2026-11-08T09:00:00Z'),
  });
  const second = await service.cancel({
    tenantId: clinic.tenantId,
    appointmentId: booked.appointment.id,
    idempotencyKey: 'cancel-2',
    now: new Date('2026-11-08T09:00:00Z'),
  });
  expect(second.status).toBe('CANCELLED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- cancel.service.spec.ts`
Expected: FAIL because `cancel` does not exist.

- [ ] **Step 3: Implement `cancel`**

1. Load the appointment. Verify `tenantId`. If already `CANCELLED`, return `CANCELLED`.
2. `operations.createOrGet({ operationType: 'CANCEL', idempotencyKey })`. If `COMPLETED`, return the stored outcome.
3. Determine `late = now >= startAt - 24 hours`.
4. Cancel the calendar event and verify. On failure, mark the appointment `UNKNOWN`, the operation `UNKNOWN`, keep the reservations (the slot stays blocked), and return `UNKNOWN`.
5. On success: mark the appointment `CANCELLED`, set `attendance_status = 'LATE_CANCELLED'` when late, release professional and resource reservations, mark the operation `COMPLETED`, return `CANCELLED`.

Authorization/identity verification belongs to the conversation flow (Task 13), not to this service.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- cancel.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: cancellation with late-cancellation tracking and idempotency"
```

---

### Task 11: Google Calendar adapter and reconciliation tests

**Files:**
- Create: `apps/api/src/calendar/google-calendar.adapter.ts`
- Test: `apps/api/test/google-calendar.adapter.spec.ts`
- Modify: `apps/api/test/reconciliation.service.spec.ts` (reschedule cases)

**Interfaces:**
- `GoogleCalendarAdapter` constructor `(options: { calendarId: string; getAccessToken: () => Promise<string>; fetchImpl?: typeof fetch; baseUrl?: string })`.
- Event id: `dental${operationId.replace(/-/g, '')}`.
- `extendedProperties.private.operation_id = operationId`.

- [ ] **Step 1: Write the failing tests**

```ts
it('creates an event with a deterministic id and operation metadata', async () => {
  const calls: any[] = [];
  const fetchImpl = async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'dentalop1' }), { status: 200 });
  };
  const calendar = new GoogleCalendarAdapter({
    calendarId: 'clinic@example.com',
    getAccessToken: async () => 'token',
    fetchImpl: fetchImpl as typeof fetch,
    baseUrl: 'https://calendar.test',
  });

  const result = await calendar.createEvent({
    operationId: 'op-1',
    tenantId: 't',
    summary: 'Limpeza — Maria',
    startAt: new Date('2026-11-09T12:00:00Z'),
    endAt: new Date('2026-11-09T12:40:00Z'),
    professionalId: 'prof-caio',
  });

  expect(result.externalEventId).toBe('dentalop1');
  expect(calls[0].body.id).toBe('dentalop1');
  expect(calls[0].body.extendedProperties.private.operation_id).toBe('op-1');
});

it('returns exists=false for a missing event', async () => {
  const calendar = new GoogleCalendarAdapter({
    calendarId: 'clinic@example.com',
    getAccessToken: async () => 'token',
    fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
    baseUrl: 'https://calendar.test',
  });
  expect(await calendar.getEvent('missing')).toEqual({ exists: false });
});

it('treats a 404 on cancel as already cancelled', async () => {
  const calendar = new GoogleCalendarAdapter({
    calendarId: 'clinic@example.com',
    getAccessToken: async () => 'token',
    fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
    baseUrl: 'https://calendar.test',
  });
  await expect(calendar.cancelEvent('missing')).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- google-calendar.adapter.spec.ts`
Expected: FAIL because `GoogleCalendarAdapter` does not exist.

- [ ] **Step 3: Implement the adapter**

`createEvent` POSTs to `${baseUrl}/calendars/${encodeURIComponent(calendarId)}/events` with `Authorization: Bearer <token>`, `id`, `summary`, `start: { dateTime, timeZone }`, `end: { dateTime, timeZone }`, and `extendedProperties.private.operation_id`. Non-2xx throws.

`getEvent` GETs the event by id; 404 returns `{ exists: false }`; 200 returns `{ exists: true, startAt, endAt }`.

`cancelEvent` DELETEs the event; 404 is treated as success.

Add the reschedule reconciliation cases to `reconciliation.service.spec.ts`:
- New event exists, old event exists -> old cancelled, new `BOOKED`, old `CANCELLED`, operation `COMPLETED`.
- New event missing -> new `CANCELLED`, new reservations `RELEASED`, old remains `BOOKED`, operation `FAILED`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- google-calendar.adapter.spec.ts reconciliation.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add Google Calendar adapter with operation-id reconciliation"
```

---

### Task 12: Conversation context and the scheduling flow

**Files:**
- Create: `supabase/migrations/0010_conversation_context.sql`
- Create: `apps/api/src/scheduling/scheduling-flow.service.ts`
- Create: `apps/api/src/scheduling/scheduling-messages.ts`
- Modify: `apps/api/src/db/repositories/conversations.repository.ts` (context get/update)
- Modify: `apps/api/src/db/repositories/rows.ts` (`Conversation.context`)
- Modify: `apps/api/src/pipeline/inbound.service.ts` (delegate to the flow after safety)
- Modify: `apps/api/src/app.module.ts` (providers)
- Test: `apps/api/test/scheduling-flow.spec.ts`

**Interfaces:**
- `SchedulingContext = { flow: 'SCHEDULE'|'RESCHEDULE'|'CANCEL'; step: 'SERVICE'|'SLOT'|'CONFIRM'|'IDENTITY'; serviceId?; quantity?; offeredSlots?: Array<{ startAt: string; professionalIds: string[] }>; appointmentId?; idempotencyKey: string; expiresAt: string }`.
- `FlowResult = { reply: string; context: SchedulingContext | null; status: 'COMPLETED'|'PENDING'|'REQUIRES_HUMAN'; appointmentId?; operationId? }`.
- `SchedulingFlowService.start(input): Promise<FlowResult>` and `handleReply(input): Promise<FlowResult>`.
- `ConversationsRepository.getContext(tenantId, conversationId): Promise<SchedulingContext | null>` and `updateContext(tenantId, conversationId, context | null): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
import { getTestPool, seedClinic, seedScheduling } from './helpers/db';
import { CatalogRepository } from '../src/db/repositories/catalog.repository';
import { AppointmentsRepository } from '../src/db/repositories/appointments.repository';
import { OperationsRepository } from '../src/db/repositories/operations.repository';
import { LocksRepository } from '../src/db/repositories/locks.repository';
import { PatientsRepository } from '../src/db/repositories/patients.repository';
import { AvailabilityService } from '../src/scheduling/availability.service';
import { SlotEngine } from '../src/scheduling/slot-engine';
import { BookingService } from '../src/scheduling/booking.service';
import { SchedulingFlowService } from '../src/scheduling/scheduling-flow.service';
import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';

const build = (pool: any) => {
  const catalog = new CatalogRepository(pool);
  const calendar = new FakeCalendarAdapter();
  const booking = new BookingService({
    catalog,
    availability: new AvailabilityService(catalog, new SlotEngine(), {
      granularityMinutes: 15,
      minAdvanceMinutes: 0,
      maxHorizonDays: 90,
    }),
    appointments: new AppointmentsRepository(pool),
    operations: new OperationsRepository(pool),
    locks: new LocksRepository(pool),
    calendar,
    now: () => new Date('2026-11-08T12:00:00-03:00'),
  });
  return {
    calendar,
    flow: new SchedulingFlowService({
      catalog,
      availability: new AvailabilityService(catalog, new SlotEngine(), {
        granularityMinutes: 15,
        minAdvanceMinutes: 0,
        maxHorizonDays: 90,
      }),
      appointments: new AppointmentsRepository(pool),
      patients: new PatientsRepository(pool),
      booking,
      now: () => new Date('2026-11-08T12:00:00-03:00'),
      horizonDays: 7,
    }),
  };
};

const start = (clinic: any, text: string) =>
  build(getTestPool()).flow.start({
    tenantId: clinic.tenantId,
    conversationId: clinic.conversationId!,
    patientContactId: clinic.contactId!,
    text,
    intent: 'SCHEDULE_REQUEST',
    context: null,
  });

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
    expect(result.reply.toLowerCase()).toContain('começar de novo');
    expect(result.context).toBeNull();
  });

  it('starts a cancel flow by asking for identity confirmation', async () => {
    const pool = getTestPool();
    const clinic = await seedClinic(pool, { withConversation: true });
    await seedScheduling(pool, clinic.tenantId);
    const { flow } = build(pool);

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- scheduling-flow.spec.ts`
Expected: FAIL because `SchedulingFlowService` does not exist.

- [ ] **Step 3: Implement the context column and the flow**

`0010_conversation_context.sql`:

```sql
alter table conversations
  add column context jsonb not null default '{}';
```

`SchedulingFlowService.start`:

- `SCHEDULE_REQUEST`:
  - Find the service by normalized keyword/name match over active services. If none, reply with the active service names and store `step = SERVICE`.
  - If the matched service has `requires_evaluation = true` or `direct_booking_allowed = false`, switch to the evaluation service (`is_evaluation = true`), reply explaining that an evaluation is the next administrative step, and continue with that service.
  - Otherwise, find slots for the next `horizonDays` and present up to three numbered options; store `step = SLOT`, `offeredSlots`, and a fresh `idempotencyKey`.
- `RESCHEDULE_REQUEST` / `CANCEL_REQUEST`:
  - Find the contact's open appointments. If none, reply safely and escalate (return `REQUIRES_HUMAN` with a reason).
  - Store `step = IDENTITY`, the chosen `appointmentId` (if only one) or ask which one, and the flow type.

`handleReply`:

- Expired context -> clear and reply “Vamos começar de novo. …”.
- `SERVICE` -> retry the service match; if still unknown, list the options again.
- `SLOT` -> parse a number 1–3; if invalid, re-prompt; if valid, store the chosen slot and `step = CONFIRM`, reply with the summary and ask SIM/NÃO.
- `CONFIRM` -> parse SIM/NÃO. On SIM, call `booking.book` with the chosen slot and the context `idempotencyKey`:
  - `BOOKED` -> success reply, clear context.
  - `CONFLICT` -> offer the alternatives and stay in `SLOT`.
  - `UNKNOWN` -> “estou confirmando com a equipe” and return `REQUIRES_HUMAN` with the operation id.
  - On NÃO -> offer the slots again.
- `IDENTITY` -> handled in Task 13.

`InboundService` integration order (after the human-active gate and before intent classification):
1. Deterministic safety triage. If `EMERGENCY`, use the existing protocol path.
2. Load `conversation.context`. If it has a non-expired scheduling context and the message is text, call `handleReply` and send/persist its reply. Do not call the AI.
3. Otherwise classify intent. If `SCHEDULE_REQUEST|RESCHEDULE_REQUEST|CANCEL_REQUEST`, call `start` and send/persist its reply.
4. Otherwise use the existing FAQ/clinical/human/unknown pipeline.

The flow returns the reply and the next context; `InboundService` owns sending, persistence and audit, so there is one outbound path. After every flow call, `InboundService` calls `conversations.updateContext(tenantId, conversationId, result.context)` (or `null` to clear it). The flow is only invoked for `messageType = 'text'`; unsupported media follows the Phase 1 path. If the flow returns `REQUIRES_HUMAN`, create a ticket with reason `UNKNOWN` and include the operation id in the ticket summary.

`scheduling-messages.ts` holds the approved copy:

- `askService(services)`
- `offerSlots(serviceName, slots)`
- `confirm(serviceName, professionalName, startAt)`
- `booked(serviceName, professionalName, startAt)`
- `conflict(slots)`
- `unknownConfirmation()`
- `askIdentity()`
- `identityMismatch()`
- `expired()`
- `noAppointment()`

All times are formatted in `America/Sao_Paulo` with `Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- scheduling-flow.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add multi-turn scheduling flow over the internal agenda"
```

---

### Task 13: Reschedule and cancel conversations with identity verification

**Files:**
- Modify: `apps/api/src/scheduling/scheduling-flow.service.ts` (IDENTITY, RESCHEDULE, CANCEL)
- Test: `apps/api/test/scheduling-flow.spec.ts` (additional cases)
- Test: `apps/api/test/e2e.scheduling.spec.ts`

**Interfaces:**
- Identity check: normalized full name must equal the patient's `full_name`, and `birth_date` must match the provided date (ISO `YYYY-MM-DD`). If the contact has no linked patient or the patient has no `birth_date`, escalate; do not cancel or reschedule.
- Ambiguous language (“acho que não vou conseguir”, “talvez”) never cancels; the flow asks for explicit confirmation.
- Reschedule uses `BookingService.reschedule`; cancel uses `BookingService.cancel`.

- [ ] **Step 1: Write the failing tests**

```ts
it('reschedules after identity confirmation, new slot first', async () => {
  // book an appointment, start RESCHEDULE_REQUEST, answer name + DOB,
  // choose a new slot, confirm SIM; assert the old is CANCELLED and the new is BOOKED.
});

it('does not reschedule when the identity does not match', async () => {
  // answer a wrong name; assert the appointment is still BOOKED and the reply escalates.
});

it('does not cancel on ambiguous language', async () => {
  // after identity, send "acho que não vou conseguir"; assert status stays BOOKED
  // and the reply asks for SIM/NÃO.
});

it('cancels only after an explicit SIM, marking late cancellation', async () => {
  // after identity, send "SIM" within 24h; assert CANCELLED + LATE_CANCELLED.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- scheduling-flow.spec.ts e2e.scheduling.spec.ts`
Expected: FAIL on the reschedule/cancel cases.

- [ ] **Step 3: Implement the flows**

`IDENTITY`:
- Parse the reply as `nome completo; data de nascimento` or two consecutive messages. Keep the step until both are present.
- Normalize the name with `normalizeText`; compare with the patient's `full_name`. Compare `birth_date` as `YYYY-MM-DD`.
- Use `PatientsRepository.findByContact(tenantId, contactId): Promise<Patient | null>` and `PatientsRepository.attachIdentity(tenantId, contactId, { fullName, birthDate }): Promise<void>`; the latter links a provisional contact to a patient record when the patient is new.
- On mismatch: clear the context, reply `identityMismatch()`, create an `UNKNOWN`/`HUMAN_REQUEST` escalation. Do not change the appointment.
- On match: for `RESCHEDULE`, find new slots and move to `SLOT`; for `CANCEL`, move to `CONFIRM` with the appointment summary.

`RESCHEDULE` confirmation:
- On SIM, call `booking.reschedule` with the chosen slot and the context `idempotencyKey`.
- `BOOKED` -> success reply with the new date; clear context.
- `CONFLICT` -> offer alternatives; stay in `SLOT`.
- `UNKNOWN` -> “estou confirmando com a equipe”; create a ticket; return `REQUIRES_HUMAN`.

`CANCEL` confirmation:
- On SIM, call `booking.cancel`.
- `CANCELLED` -> reply with the late-cancellation note when applicable; clear context.
- `UNKNOWN` -> “estou confirmando o cancelamento”; create a ticket; return `REQUIRES_HUMAN`.
- On any other text, including “acho que não vou conseguir”, ask “Confirma o cancelamento? Responda SIM ou NÃO.” and keep the appointment.

E2E via `POST /webhooks/telegram/:channel`:
- Schedule: “quero marcar limpeza” -> 3 options -> “1” -> “SIM” -> appointment `BOOKED`, one calendar event, one outbound confirmation.
- Reschedule: book, “quero remarcar” -> identity -> new slot -> SIM -> old `CANCELLED`, new `BOOKED`.
- Cancel: book, “quero cancelar” -> identity -> “acho que não” -> still `BOOKED` -> “SIM” -> `CANCELLED`.
- Emergency during a flow: “não consigo respirar” -> SAMU, no scheduling action.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npm test -- scheduling-flow.spec.ts e2e.scheduling.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: reschedule and cancel conversations with identity verification"
```

---

### Task 14: Pilot seed, reconciliation CLI and documentation

**Files:**
- Create: `apps/api/src/cli/seed-scheduling.ts`
- Create: `apps/api/src/cli/reconcile.ts` (if not created in Task 8)
- Modify: `apps/api/package.json` (`seed:scheduling`, `reconcile`)
- Modify: `README.md`, `AGENTS.md`
- Test: `apps/api/test/e2e.scheduling.spec.ts` (full acceptance)

**Interfaces:**
- `npm run seed:scheduling` seeds the fictional catalog, hours, joint requirements and one chair for the dev clinic. It is idempotent.
- `npm run reconcile` releases expired locks and reconciles `UNKNOWN` operations for every tenant.
- README documents the demo, the reconciliation command and the Phase 2 scope.

- [ ] **Step 1: Write the failing acceptance test**

```ts
it('runs the full schedule -> book -> reschedule -> cancel cycle through the webhook', async () => {
  // 1. POST "quero marcar limpeza"
  // 2. read the offered slots from the outbound message
  // 3. POST "1", then "SIM"
  // 4. assert appointments.status = BOOKED, professional_reservations = BOOKED,
  //    resource_reservations = BOOKED, calendar event exists, one outbound confirmation
  // 5. POST "quero remarcar", answer identity, choose a new slot, "SIM"
  // 6. assert old CANCELLED with RELEASED reservations, new BOOKED
  // 7. POST "quero cancelar", answer identity, "SIM"
  // 8. assert new CANCELLED, reservations RELEASED, calendar event cancelled
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- e2e.scheduling.spec.ts`
Expected: FAIL because the full cycle is not wired.

- [ ] **Step 3: Implement the seed, CLI and docs**

`seed-scheduling.ts` loads `.env`, connects, finds the seeded clinic, and calls the `seedScheduling` fixture (or an equivalent idempotent SQL seed) with the fictional catalog. It prints the ids it created or reused.

`reconcile.ts` loads `.env`, connects, calls `releaseExpiredLocks(new Date())`, lists tenants with `UNKNOWN` operations, calls `reconcileUnknown` for each, and prints `confirmed`, `failed` and `releasedLocks`.

README adds:

- `npm run seed:scheduling`
- `npm run reconcile`
- the full demo conversation
- the Phase 2 statuses (`BOOKED`, `RESCHEDULE_PENDING`, `CANCELLED`, `UNKNOWN`)
- the note that the catalog is fictional until the partners validate it.

AGENTS adds the Phase 2 pipeline order:

1. safety triage;
2. active scheduling context -> flow reply;
3. schedule/reschedule/cancel intent -> flow start;
4. FAQ/clinical/human/unknown as in Phase 1.

and the rule: “the database exclusion constraint is the final guard; never replace it with an application check”.

- [ ] **Step 4: Run the full suite**

Run: `cd apps/api && npm test`
Expected: PASS, including the Phase 1 suite and the new Phase 2 suite.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add pilot scheduling seed, reconciliation CLI and docs"
```

---

## Self-Review

**1. Spec coverage (Phase 2)**

| Blueprint requirement | Task |
|---|---|
| `working_hours`, `time_off`, `holidays`, `resources` | 1 |
| `services`, variants, habilitation, joint requirements | 1 |
| `appointments`, `appointment_professionals`, operations, locks | 2 |
| Internal agenda as source of truth | 3, 5 |
| Slot engine with buffers, advance, horizon, joint intersection | 4, 5 |
| Booking with lock, revalidation, event, verification | 7 |
| Zero double booking in concurrency tests | 2, 7, 8 |
| Reschedule: new before old, compensation | 9 |
| Cancellation with policy and explicit confirmation | 10, 13 |
| `CalendarAdapter` + fake + Google | 6, 11 |
| `UNKNOWN` and reconciliation by `operation_id` | 8, 11 |
| Joint procedures | 1, 4, 5 |
| Conversation integration | 12, 13 |
| Pilot configuration and docs | 14 |
| Attendance status for late cancellation | 2, 10 |
| Adapter/feature flags for future ERP | 6, 11 |

**2. Step scan**

Each task names files, exact signatures, the failing test, the runnable command and the expected output. The only deferred item is real Google OAuth token acquisition: the adapter receives a `getAccessToken` function, and the configuration of the service account/refresh token is a pilot setup step, not production code invented in the plan.

**3. Type consistency**

`SlotRequest`, `Slot`, `SlotEngineInput`, `BookInput`, `BookingOutcome`, `RescheduleInput`, `CancelInput`, `CalendarEvent` and `SchedulingContext` are defined once and referenced by name. `professional_reservations` and `resource_reservations` share the same status vocabulary. `AppointmentsRepository.createWithReservations` receives `blockingStartAt`/`blockingEndAt` so the buffer rule lives in one place.

**4. Review Focus**

| Risk | Test |
|---|---|
| Double booking | Task 8 `Promise.all` race + Task 2 exclusion constraint |
| Joint with one busy professional | Task 4 joint test + Task 5 availability test |
| Reschedule loses original | Task 9 new-slot-taken and old-cancel-failure tests |
| Calendar timeout/orphan | Task 8 timeout + reconciliation tests |
| Timezone/buffer/holiday/lunch | Task 4 engine tests + Task 5 seeded schedule |

**5. Proportion**

The plan is 14 tasks, each with a narrow test cycle. It does not include full implementation bodies; it pins the decisions, signatures, constraints and expected test outcomes. The Google OAuth acquisition, real clinic data and the pilot calendar import remain configuration steps, not code.





