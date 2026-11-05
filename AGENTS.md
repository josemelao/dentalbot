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

Scheduling, reminders, WhatsApp Cloud API, real owner delivery and the panel are
Phase 2/3. See `0 - MVP Blueprint - Dental Assistant.md`.

## Pipeline order (Phase 2)

1. Deduplicate the channel event in `webhook_events`.
2. Resolve `tenant_id`, contact and conversation.
3. If a human ticket is open, set `HUMAN_ACTIVE` and do not auto-reply.
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
