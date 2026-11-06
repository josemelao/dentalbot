-- Shadow mode: the bot drafts, a human approves before the patient sees it.
-- Off by default so an existing pilot keeps behaving as today.
alter table clinics add column shadow_mode boolean not null default false;

create table pending_replies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  conversation_id uuid not null,
  patient_contact_id uuid not null,
  content text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENT', 'DISCARDED')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);

create index pending_replies_tenant_status_idx
  on pending_replies (tenant_id, status, created_at);
