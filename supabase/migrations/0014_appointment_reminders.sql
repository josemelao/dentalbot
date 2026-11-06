-- One row per reminder actually sent (or claimed). The unique key is the
-- idempotency guard: a job that runs twice never reminds the same patient twice.
create table appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  appointment_id uuid not null,
  kind text not null check (kind in ('24H', '48H')),
  channel text not null check (channel in ('whatsapp', 'telegram')),
  sent_at timestamptz,
  external_message_id text,
  created_at timestamptz not null default now(),
  unique (appointment_id, kind),
  foreign key (tenant_id, appointment_id) references appointments (tenant_id, id)
);

create index appointment_reminders_tenant_sent_idx
  on appointment_reminders (tenant_id, sent_at);

create index appointments_reminder_lookup_idx
  on appointments (tenant_id, start_at)
  where status = 'BOOKED';
