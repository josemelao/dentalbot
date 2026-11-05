alter table patients
  add constraint patients_tenant_id_id_key unique (tenant_id, id);

alter table patient_contacts
  add constraint patient_contacts_tenant_id_id_key unique (tenant_id, id);

alter table conversations
  add constraint conversations_tenant_id_id_key unique (tenant_id, id);

alter table messages
  add constraint messages_tenant_id_id_key unique (tenant_id, id);

alter table human_tickets
  add constraint human_tickets_tenant_id_id_key unique (tenant_id, id);

alter table knowledge_entries
  add constraint knowledge_entries_tenant_id_id_key unique (tenant_id, id);

alter table conversations
  add constraint conversations_contact_tenant_fk
  foreign key (tenant_id, patient_contact_id)
  references patient_contacts (tenant_id, id);

alter table messages
  add constraint messages_conversation_tenant_fk
  foreign key (tenant_id, conversation_id)
  references conversations (tenant_id, id);

alter table human_tickets
  add constraint human_tickets_conversation_tenant_fk
  foreign key (tenant_id, conversation_id)
  references conversations (tenant_id, id);

alter table human_tickets
  add constraint human_tickets_contact_tenant_fk
  foreign key (tenant_id, patient_contact_id)
  references patient_contacts (tenant_id, id);

alter table ticket_events
  add constraint ticket_events_ticket_tenant_fk
  foreign key (tenant_id, ticket_id)
  references human_tickets (tenant_id, id);
