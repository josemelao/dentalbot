create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  locale text not null default 'pt-BR',
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table clinic_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  channel text not null check (channel in ('whatsapp', 'telegram')),
  provider text not null,
  external_channel_id text not null,
  display_name text,
  status text not null default 'active',
  credentials_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, channel, external_channel_id),
  unique (channel, external_channel_id)
);

create table clinic_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  auth_user_id uuid,
  name text not null,
  email citext,
  phone_e164 text,
  role text not null check (role in ('owner', 'dentist', 'receptionist', 'admin')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);
