# Dental Assistant

Administrative virtual secretary for dental clinics. Phase 0–1 implements the
foundation, inbound message handling, identity/context, safety triage and an
approved administrative FAQ.

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

## Demo without WhatsApp/Telegram credentials

`apps/api/.env.example` sets `CHANNEL_TRANSPORT=fake` and `AI_PROVIDER=fake`.
The fake channel records the outbound reply locally while the message is still
persisted in PostgreSQL, so the demo needs no Meta or Telegram credentials.

With the API running, post a Telegram-shaped update. Send the body as UTF-8
bytes so accents survive Windows PowerShell:

```powershell
$body = '{"update_id":1,"message":{"message_id":1,"date":1730000000,"chat":{"id":42},"from":{"id":42},"text":"Qual o horário de vocês?"}}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/webhooks/telegram/bot-pilot" `
  -Headers @{ "x-telegram-bot-api-secret-token" = "change-me" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $bytes
```

Then read the persisted conversation (from the repository root):

```powershell
docker compose exec db psql -U postgres -d dental_assistant `
  -c "select direction, content from messages order by created_at desc limit 2;"
```

Expected: one `in` row with the question and one `out` row with the approved
answer seeded by `npm run seed`.

A question without an approved answer returns the holding message and creates a
ticket:

```powershell
docker compose exec db psql -U postgres -d dental_assistant `
  -c "select reason, status, sla_due_at from human_tickets order by created_at desc limit 1;"
```

An emergency message (for example "Não consigo respirar") returns the safety
protocol with SAMU 192 and creates an `EMERGENCY` ticket instead of an
administrative answer.

## AI provider

- `AI_PROVIDER=fake` (default): deterministic keyword rules, no key, used by
  tests and the local demo.
- `AI_PROVIDER=openai`: requires `OPENAI_API_KEY`. The intent response is
  schema-validated; invalid output falls back to `UNKNOWN`.

## Channel transport

- `CHANNEL_TRANSPORT=fake` (default in `.env.example`): records replies locally.
- `CHANNEL_TRANSPORT=telegram`: sends through `TELEGRAM_BOT_TOKEN` and requires
  `TELEGRAM_WEBHOOK_SECRET` to match the
  `X-Telegram-Bot-Api-Secret-Token` header.

## Tests

```powershell
cd apps/api
npm test
```

The suite needs the PostgreSQL container. It creates and migrates
`dental_assistant_test` automatically.

## Phase 1 boundaries

- Scheduling, rescheduling, cancellation, reminders, WhatsApp Cloud API and the
  panel are Phase 2+.
- Owner notification is persisted as `ticket_events` in Phase 1; real delivery
  to the dentists is Phase 3.
- Webhook processing is in-request in Phase 1. The `webhook_events` row is
  written before processing, so a crash leaves a reprocessable event; the
  worker arrives in Phase 3.
- `audit_logs` is append-only.
