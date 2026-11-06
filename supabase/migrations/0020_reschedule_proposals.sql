-- A reschedule proposal started by the clinic, waiting for the patient to pick
-- a slot. One pending proposal per appointment.
create table reschedule_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references clinics (id),
  appointment_id uuid not null,
  conversation_id uuid not null,
  slots jsonb not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED')),
  created_by uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, appointment_id) references appointments (tenant_id, id)
);

create unique index reschedule_proposals_pending_idx
  on reschedule_proposals (appointment_id)
  where status = 'PENDING';

create index reschedule_proposals_conversation_idx
  on reschedule_proposals (tenant_id, conversation_id, status);
