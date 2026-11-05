# Dental Assistant

Administrative virtual secretary for dental clinics. Phase 0–1 implements the
foundation, inbound message handling, identity/context and an approved
administrative FAQ.

## Requirements

- Node 24+
- npm 11+
- Docker (PostgreSQL 16)

## Run locally

```powershell
# from the repository root
docker compose up -d

cd apps/api
copy .env.example .env
npm install
npm run migrate
npm run seed
npm run dev
```

The API listens on `http://localhost:3000`. `GET /health` returns
`{ "status": "ok", "database": "up" }`.

## AI provider

`AI_PROVIDER=fake` is the default and needs no key: intent classification is
deterministic and used by tests. `AI_PROVIDER=openai` requires
`OPENAI_API_KEY`.

## Tests

```powershell
cd apps/api
npm test
```

The suite needs the PostgreSQL container. It creates and migrates
`dental_assistant_test` automatically.

## Scope

Phase 0–1: foundation, inbound (Telegram adapter for tests), identity and
context, safety triage, approved administrative FAQ and escalation. Scheduling,
reminders, WhatsApp Cloud API and the panel are Phase 2+.
