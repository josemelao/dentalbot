-- Per-professional personal calendar, used only for free/busy.
alter table professionals add column calendar_id text;

-- The clinic removed the appointment on Google: the slot is at risk and needs a
-- new time, but the patient must never be cancelled silently.
alter table appointments drop constraint appointments_status_check;

alter table appointments add constraint appointments_status_check
  check (
    status in (
      'BOOKING', 'BOOKED', 'RESCHEDULE_PENDING', 'RESCHEDULE_REQUIRED',
      'CANCELLED', 'COMPLETED', 'NO_SHOW', 'UNKNOWN'
    )
  );
