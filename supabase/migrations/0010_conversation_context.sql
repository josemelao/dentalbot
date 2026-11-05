alter table conversations
  add column context jsonb not null default '{}';
