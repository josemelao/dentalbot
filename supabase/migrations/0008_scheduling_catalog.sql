alter table clinic_users
  add constraint clinic_users_tenant_id_id_key unique (tenant_id, id);

alter table patient_contacts
  add constraint patient_contacts_patient_tenant_fk
  foreign key (tenant_id, patient_id)
  references patients (tenant_id, id);

create table locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  name text not null,
  address text,
  timezone text not null default 'America/Sao_Paulo',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, id)
);

create table resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  location_id uuid not null,
  name text not null,
  kind text not null default 'chair' check (kind in ('chair', 'room', 'equipment')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, location_id) references locations (tenant_id, id),
  unique (tenant_id, location_id, name),
  unique (tenant_id, id)
);

create table professionals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  clinic_user_id uuid,
  location_id uuid not null,
  name text not null,
  specialty text,
  calendar_ref text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, clinic_user_id) references clinic_users (tenant_id, id),
  foreign key (tenant_id, location_id) references locations (tenant_id, id),
  unique (tenant_id, name),
  unique (tenant_id, id)
);

create table professional_working_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  professional_id uuid not null,
  location_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  valid_from date not null default current_date,
  valid_to date,
  check (start_time < end_time),
  foreign key (tenant_id, professional_id) references professionals (tenant_id, id),
  foreign key (tenant_id, location_id) references locations (tenant_id, id),
  unique (tenant_id, professional_id, location_id, weekday, start_time)
);

create table professional_time_off (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  professional_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (start_at < end_at),
  foreign key (tenant_id, professional_id) references professionals (tenant_id, id)
);

create table clinic_holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  location_id uuid,
  holiday_date date not null,
  name text not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, location_id) references locations (tenant_id, id),
  unique (tenant_id, location_id, holiday_date)
);

create unique index clinic_holidays_global_date_key
  on clinic_holidays (tenant_id, holiday_date)
  where location_id is null;

create table services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  name text not null,
  description text,
  keywords text[] not null default '{}',
  is_evaluation boolean not null default false,
  duration_minutes integer not null check (duration_minutes > 0),
  price numeric(12, 2) not null check (price >= 0),
  price_disclosure_allowed boolean not null default false,
  direct_booking_allowed boolean not null default false,
  requires_evaluation boolean not null default true,
  preparation_instructions text,
  required_documents text[] not null default '{}',
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes >= 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, id)
);

create table service_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  service_id uuid not null,
  min_quantity integer not null check (min_quantity > 0),
  max_quantity integer not null check (max_quantity >= min_quantity),
  price numeric(12, 2) not null check (price >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, service_id) references services (tenant_id, id),
  unique (tenant_id, service_id, min_quantity)
);

create table professional_services (
  tenant_id uuid not null references clinics (id),
  professional_id uuid not null,
  service_id uuid not null,
  primary key (tenant_id, professional_id, service_id),
  foreign key (tenant_id, professional_id) references professionals (tenant_id, id),
  foreign key (tenant_id, service_id) references services (tenant_id, id)
);

create table service_professional_requirements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  service_id uuid not null,
  professional_id uuid not null,
  role text not null default 'required' check (role in ('primary', 'assistant', 'required')),
  required boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, service_id) references services (tenant_id, id),
  foreign key (tenant_id, professional_id) references professionals (tenant_id, id),
  unique (tenant_id, service_id, professional_id)
);
