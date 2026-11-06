-- A ticket accepted by a human that stayed without a reply needs its own event,
-- so the alert is sent once per idle period.
alter table ticket_events drop constraint ticket_events_event_check;

alter table ticket_events add constraint ticket_events_event_check
  check (
    event in (
      'created', 'notified', 'accepted', 'answered', 'resolved',
      'fallback', 'reclassified', 'idle_alert'
    )
  );
