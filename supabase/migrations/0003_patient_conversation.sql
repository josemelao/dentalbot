create table patients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  full_name text,
  birth_date date,
  is_minor boolean not null default false,
  guardian_patient_id uuid references patients (id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index patients_tenant_name_idx on patients (tenant_id, full_name);

create table patient_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  patient_id uuid references patients (id),
  channel text not null check (channel in ('whatsapp', 'telegram')),
  external_user_id text not null,
  display_name text,
  opt_in_status text not null default 'unknown'
    check (opt_in_status in ('unknown', 'opted_in', 'opted_out')),
  opt_in_at timestamptz,
  opt_out_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, channel, external_user_id)
);
create index patient_contacts_tenant_channel_idx on patient_contacts (tenant_id, channel);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  patient_contact_id uuid not null references patient_contacts (id),
  channel text not null check (channel in ('whatsapp', 'telegram')),
  state text not null default 'ACTIVE'
    check (state in ('ACTIVE', 'REQUIRES_HUMAN', 'HUMAN_ACTIVE', 'CLOSED')),
  human_ticket_id uuid,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_open_conversation_per_contact
  on conversations (tenant_id, patient_contact_id)
  where state <> 'CLOSED';
create index conversations_tenant_state_idx on conversations (tenant_id, state);

create table messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  conversation_id uuid not null references conversations (id),
  channel text not null check (channel in ('whatsapp', 'telegram')),
  direction text not null check (direction in ('in', 'out')),
  external_message_id text,
  message_type text not null
    check (message_type in ('text', 'audio', 'image', 'document', 'button', 'unsupported')),
  content text,
  media jsonb,
  delivery_status text not null default 'received'
    check (delivery_status in ('received', 'sent', 'failed', 'delivered', 'read')),
  created_at timestamptz not null default now()
);
create unique index messages_tenant_channel_external_id_key
  on messages (tenant_id, channel, external_message_id)
  where external_message_id is not null;
create index messages_tenant_conversation_idx on messages (tenant_id, conversation_id, created_at);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  channel text not null check (channel in ('whatsapp', 'telegram')),
  external_event_id text not null,
  external_message_id text,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed', 'skipped')),
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (tenant_id, channel, external_event_id)
);
create index webhook_events_status_idx on webhook_events (status, received_at);
