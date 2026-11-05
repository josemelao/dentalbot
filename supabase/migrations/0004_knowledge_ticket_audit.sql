create table knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  category text not null,
  question text not null,
  answer text not null,
  keywords text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_entries_tenant_status_idx on knowledge_entries (tenant_id, status);
create index knowledge_entries_keywords_idx on knowledge_entries using gin (keywords);

create table human_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  conversation_id uuid not null references conversations (id),
  patient_contact_id uuid not null references patient_contacts (id),
  status text not null default 'open'
    check (status in ('open', 'notified', 'answered', 'resolved', 'cancelled')),
  reason text not null check (reason in ('CLINICAL', 'UNKNOWN', 'HUMAN_REQUEST', 'EMERGENCY')),
  summary text not null,
  question text not null,
  options jsonb not null default '[]',
  answer text,
  answered_by uuid,
  answered_at timestamptz,
  sla_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index human_tickets_tenant_status_idx on human_tickets (tenant_id, status, sla_due_at);

create table ticket_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  ticket_id uuid not null references human_tickets (id),
  event text not null
    check (event in ('created', 'notified', 'accepted', 'answered', 'resolved', 'fallback')),
  actor_type text not null,
  actor_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index ticket_events_ticket_idx on ticket_events (ticket_id, created_at);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  actor_type text not null check (actor_type in ('patient', 'bot', 'human', 'system')),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  correlation_id uuid,
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_created_idx on audit_logs (tenant_id, created_at);

create function audit_logs_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

create trigger audit_logs_append_only_trigger
before update or delete on audit_logs
for each row execute function audit_logs_append_only();

create table ai_invocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  conversation_id uuid,
  message_id uuid,
  provider text not null,
  model text not null,
  prompt_version text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  latency_ms integer not null default 0,
  confidence numeric(4, 3),
  decision jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index ai_invocations_tenant_created_idx on ai_invocations (tenant_id, created_at);
