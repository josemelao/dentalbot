# AGENTS.md — Dental Assistant

## Purpose

Administrative virtual secretary for dental clinics. It answers approved
administrative questions, collects data, schedules and escalates to a human
when the question is clinical or unknown. It never diagnoses, prescribes,
interprets exams or impersonates the dentists.

## Commands (run from `apps/api`)

- `npm install`
- `npm test` — Jest + Supertest (requires PostgreSQL from `docker compose up -d`)
- `npm run build`
- `npm run dev`
- `npm run migrate`
- `npm run seed`
- `npm run lint`

## Non-negotiable rules

1. `tenant_id` is derived from `clinic_channels`, never from the message body
   or from AI output.
2. Every read and write of tenant data filters by `tenant_id`.
3. No clinical advice, diagnosis, prescription or exam interpretation.
4. Emergency/risk detection overrides the administrative flow.
5. Administrative answers must come from an approved, in-force
   `knowledge_entries` row or a structured clinic record. No invention.
6. Critical operations use database uniqueness/idempotency, not `if` checks.
7. No PII in logs (phone numbers masked, message bodies redacted).
8. No n8n in the critical path.

## Scope

Phase 0–1 covers foundation, inbound, identity/context and administrative FAQ.

## Pipeline order (Phase 1)

1. Deduplicate the channel event in `webhook_events`.
2. Resolve `tenant_id` and the channel in `clinic_channels`.
3. Create/reuse the contact and open conversation; append the inbound message.
4. If a human ticket is open, set `HUMAN_ACTIVE` and do not auto-reply.
5. Run deterministic safety triage. `EMERGENCY` overrides everything and always
   sends the safety protocol, even if ticket creation fails.
6. Clinical or clinical-intent messages create a `CLINICAL` ticket and send the
   holding message.
7. Human requests create a `HUMAN_REQUEST` ticket.
8. Administrative FAQ answers come verbatim from an approved, in-force
   `knowledge_entries` row. No entry means `UNKNOWN` escalation, never invention.
9. Greeting, unsupported media and unknown intents have explicit safe replies.
   Telegram `/start` and `/help` count as greetings and must never open a ticket.

Scheduling, reminders, WhatsApp Cloud API, real owner delivery and the panel are
Phase 2/3. See `0 - MVP Blueprint - Dental Assistant.md`.

## Pipeline order (Phase 2)

1. Deduplicate the channel event in `webhook_events`.
2. Resolve `tenant_id`, contact and conversation.
3. An open ticket is a queued task, not a takeover: keep serving safe
   administrative intents. Only an explicitly accepted ticket (`accepted_at`)
   sets `HUMAN_ACTIVE` and silences the bot. An emergency still sends the safety
   protocol, and a clinical signal upgrades the open ticket (`reclassified`) so
   the record is not lost.
4. Run deterministic safety triage. `EMERGENCY` always wins.
5. If the conversation has an active scheduling context, handle the reply in the
   flow (service, slot, confirmation or identity) without calling the AI.
6. Otherwise classify intent. `SCHEDULE_REQUEST`, `RESCHEDULE_REQUEST` and
   `CANCEL_REQUEST` start the scheduling flow.
7. FAQ, clinical, human and unknown intents follow the Phase 1 pipeline.

## Scheduling invariants

- The database exclusion constraint on `professional_reservations` and
  `resource_reservations` is the final guard against double booking.
- Reschedule creates and verifies the new reservation before cancelling the old.
- A calendar timeout is `UNKNOWN`, reconciled by `operation_id`; never blindly
  retried.
- Joint procedures require every required professional and the chair.
- Identity (full name + birth date) is required before reschedule/cancel.

## Ticket and SLA invariants

- `open`/`notified` means the ticket is queued. `accepted_at` means a human took
  over; only then is the conversation `HUMAN_ACTIVE` and the bot silent.
- Resolving a ticket returns the conversation to `ACTIVE` and the bot resumes.
- A stronger reason always wins: `EMERGENCY` > `CLINICAL` > `HUMAN_REQUEST` >
  `UNKNOWN`. A weaker signal never downgrades a ticket.
- If nobody accepts by `sla_due_at`, the patient receives the SLA fallback. Never
  leave a patient without a reply or a fallback.
- Accepting a ticket disables the patient-facing fallback, so the idle job must
  warn the owners when an accepted ticket has no human reply.

## Owner channel invariants

- An id present in `clinic_user_channels` is staff, never a patient. Routing must
  check it before creating a contact or conversation.
- The dentist answers the bot (`1` assume, `2` resolve, `3 <text>` relay); the bot
  composes and sends to the patient. The dentist never messages the patient
  directly.
- The card never carries the full external id: display name, or a masked tail.
- A failed delivery to one owner must not stop the others.

## Reminder and worker invariants

- Recurring work runs in a separate worker, never in the request path, and every
  job runs under an advisory lock so two workers cannot double-send.
- Every job must be idempotent: running it twice must not message a patient twice.
  `appointment_reminders` uniqueness is the guard for reminders.
- A reminder is claimed before sending and released on failure, so a transport
  error retries instead of losing the reminder.
- Silence is never confirmation. Only an explicit reply sets `CONFIRMED`.
- A reminder is only eligible for `BOOKED` appointments with `PENDING`
  confirmation, and never for an opted-out contact.

## Attendance invariants

- Only a past appointment can be closed; a future one is rejected.
- A cancelled or `RESCHEDULE_PENDING` appointment has no attendance to close.
- `LATE_CANCELLED` is never counted as a no-show. The no-show rate is
  `NO_SHOW / (ATTENDED + NO_SHOW)`.
- Silence is not attendance: an unclosed appointment stays `PENDING` and must
  show up in the day list.

## Conversation style invariants

- Wording may vary; **facts may not**. FAQ answers stay verbatim from the approved
  entry, and the emergency protocol is a single fixed string that never varies.
- The unknown router returns a **route**, never a patient-facing sentence. An FAQ
  route must point at an approved, in-force entry of that tenant, validated in
  code. Low confidence means `HUMAN`.
- One ambiguous message earns one clarifying question, not a ticket.
- Variation is per message; tests pin the first variant so assertions stay stable.

## Panel invariants

- The panel token is a shared secret, **not** authentication. It must never be
  treated as a login, and the panel must not be exposed publicly without TLS.
- The real access path is the signed session cookie (e-mail + password). The
  legacy `PANEL_TOKEN` is a bootstrap accepted only outside production.
- Every panel action is attributed to the signed-in user in `audit_logs`.
- Every panel write is tenant-scoped by the active clinic and goes through the
  same repositories as the bot, so audit and validation stay in one place.
- Editing a FAQ answer changes exactly what the bot says to patients: only
  `approved` entries are used, and the answer is sent verbatim.
- Opening a ticket marks the operator side as read (`panel_read_at`). This is not
  a read receipt for the patient and must never be shown as one.
- Panel actions reuse the same services as the Telegram commands, so behaviour
  and audit never diverge between the two entry points.
