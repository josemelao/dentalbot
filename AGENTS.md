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
Scheduling, reminders, WhatsApp Cloud API, escalation delivery and the panel
arrive in later phases. See `0 - MVP Blueprint - Dental Assistant.md`.
