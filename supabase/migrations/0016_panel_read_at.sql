-- When the operator last opened the ticket in the panel. Used only to count
-- unread patient messages; it is not a delivery or read receipt for the patient.
alter table conversations add column panel_read_at timestamptz;
