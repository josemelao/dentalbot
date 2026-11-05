create extension if not exists btree_gist;

create table appointment_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  idempotency_key text not null,
  operation_type text not null check (operation_type in ('BOOK', 'RESCHEDULE', 'CANCEL')),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'COMPLETED', 'FAILED', 'UNKNOWN')),
  request_payload jsonb not null default '{}',
  result_payload jsonb not null default '{}',
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, id)
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  patient_contact_id uuid not null,
  patient_id uuid,
  service_id uuid not null,
  location_id uuid not null,
  resource_id uuid,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'BOOKING'
    check (status in ('BOOKING', 'BOOKED', 'RESCHEDULE_PENDING', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'UNKNOWN')),
  source text not null default 'bot' check (source in ('bot', 'human', 'import')),
  created_by uuid,
  cancellation_reason text,
  attendance_status text not null default 'PENDING'
    check (attendance_status in ('PENDING', 'ATTENDED', 'NO_SHOW', 'LATE_CANCELLED')),
  confirmation_status text not null default 'PENDING'
    check (confirmation_status in ('PENDING', 'CONFIRMED', 'DECLINED')),
  google_event_id text,
  operation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  foreign key (tenant_id, patient_contact_id) references patient_contacts (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients (tenant_id, id),
  foreign key (tenant_id, service_id) references services (tenant_id, id),
  foreign key (tenant_id, location_id) references locations (tenant_id, id),
  foreign key (tenant_id, resource_id) references resources (tenant_id, id),
  foreign key (tenant_id, operation_id) references appointment_operations (tenant_id, id),
  unique (tenant_id, id)
);

create table appointment_professionals (
  tenant_id uuid not null references clinics (id),
  appointment_id uuid not null,
  professional_id uuid not null,
  role text not null default 'primary' check (role in ('primary', 'assistant', 'required')),
  primary key (tenant_id, appointment_id, professional_id),
  foreign key (tenant_id, appointment_id) references appointments (tenant_id, id),
  foreign key (tenant_id, professional_id) references professionals (tenant_id, id)
);

create table professional_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  appointment_id uuid not null,
  professional_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'BOOKED'
    check (status in ('BOOKED', 'RESCHEDULE_PENDING', 'RELEASED')),
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  foreign key (tenant_id, appointment_id) references appointments (tenant_id, id),
  foreign key (tenant_id, professional_id) references professionals (tenant_id, id),
  unique (tenant_id, id)
);

alter table professional_reservations
  add constraint professional_reservations_no_overlap
  exclude using gist (
    professional_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status in ('BOOKED', 'RESCHEDULE_PENDING'));

create table resource_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  appointment_id uuid not null,
  resource_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'BOOKED'
    check (status in ('BOOKED', 'RESCHEDULE_PENDING', 'RELEASED')),
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  foreign key (tenant_id, appointment_id) references appointments (tenant_id, id),
  foreign key (tenant_id, resource_id) references resources (tenant_id, id),
  unique (tenant_id, id)
);

alter table resource_reservations
  add constraint resource_reservations_no_overlap
  exclude using gist (
    resource_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status in ('BOOKED', 'RESCHEDULE_PENDING'));

create table availability_locks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  professional_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  expires_at timestamptz not null,
  operation_id uuid,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'RELEASED', 'EXPIRED')),
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  foreign key (tenant_id, professional_id) references professionals (tenant_id, id),
  foreign key (tenant_id, operation_id) references appointment_operations (tenant_id, id)
);

create index availability_locks_active_idx
  on availability_locks (tenant_id, professional_id, expires_at)
  where status = 'ACTIVE';
