create unique index one_open_ticket_per_conversation
  on human_tickets (tenant_id, conversation_id)
  where status in ('open', 'notified', 'answered');
