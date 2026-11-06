-- A ticket being open is not the same as a human having taken over the
-- conversation. `accepted_at` records the explicit takeover ("assumir"); only
-- then does the bot go quiet.
alter table human_tickets
  add column accepted_at timestamptz,
  add column accepted_by uuid references clinic_users (id);

create index human_tickets_accepted_idx
  on human_tickets (tenant_id, accepted_at)
  where accepted_at is not null;

-- The SLA sweep looks for overdue tickets that nobody accepted.
create index human_tickets_sla_idx
  on human_tickets (tenant_id, sla_due_at)
  where status in ('open', 'notified');
