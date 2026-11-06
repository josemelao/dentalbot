-- Editable copy for the conversation flow. `locked` keys (safety, SLA, clinical)
-- can never be changed from the panel.
create table message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  key text not null,
  variants text[] not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);
