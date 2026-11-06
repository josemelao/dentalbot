-- Where each clinic user can be reached. The bot notifies these ids and accepts
-- owner commands from them; an id listed here is staff, never a patient.
create table clinic_user_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  user_id uuid not null references clinic_users (id),
  channel text not null check (channel in ('whatsapp', 'telegram')),
  external_user_id text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, channel, external_user_id)
);

create index clinic_user_channels_user_idx
  on clinic_user_channels (tenant_id, user_id);
