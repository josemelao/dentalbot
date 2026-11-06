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

## Conversational style

The bot varies its wording (2–4 variants per message, pinned deterministically in
tests) and shows a typing indicator before answering. The approved facts never
change: FAQ answers still come verbatim from `knowledge_entries`, and the
emergency protocol is a single fixed string.

| Env | Effect |
|---|---|
| `MESSAGE_EMOJI` | `false` removes every emoji |
| `TYPING_MIN_MS` / `TYPING_PER_CHAR_MS` / `TYPING_MAX_MS` | typing delay (default ~1–2s) |

The patient can answer with a number, an ordinal, a weekday or a period of the
day: `1`, `pode ser a segunda`, `sexta pode ser`, `qualquer um de manhã` (ambiguous
asks again). Identity accepts `10/05/1990`, `1990-05-10` or
`10 de maio de 1990`.

### AI provider

`AI_PROVIDER` accepts `fake` (default, deterministic), `openai` or `gemini`.
The Gemini free tier works for testing: Flash models only, rate-limited, and
**Google may use free-tier data to improve its products** — do not put real
patient data through it. Use the paid tier (or OpenAI) for the pilot.

### Unknown router

When the deterministic rules miss, an LLM router gets a second chance. It returns
a **route**, never a sentence:

```
UNKNOWN → router → { route: FAQ, entryId } → answers verbatim from the approved entry
                 → { route: SCHEDULE | RESCHEDULE | CANCEL | LIST } → existing flow
                 → { route: SMALL_TALK } → friendly reply
                 → { route: HUMAN } → one clarifying question, then a ticket
```

Guardrails: the `entryId` must exist in the approved, in-force entries of that
tenant; low confidence means `HUMAN`; an invalid answer from the model falls back
to the clarify path. Without `AI_PROVIDER`, the router is disabled and behaviour
is unchanged.

## Pilot panel

A panel is served by the API itself, so the clinic has a screen today without a
second app:

```
http://localhost:3000/painel/login
```

Login uses the clinic user's e-mail and password. The session is a signed,
HttpOnly cookie valid for 8 hours.

```powershell
# Set or reset a user's panel password
npm run user:password -- chow@example.com "uma senha forte"
```

`PANEL_TOKEN` still works as a **non-production bootstrap** (for the local demo),
never in production. Without `SESSION_SECRET` login is disabled.

It shows the day agenda, the open tickets, the approved FAQ and the service
prices. FAQ answers and service price/duration/status are editable in place.

Clicking a ticket opens the full conversation, so the operator sees everything
the patient wrote — not only the message that created the ticket. Opening it
clears the unread badge (`conversations.panel_read_at`).

From a ticket you can reply, assume and close. The reply goes through the same
`EscalationService.reply` used by the Telegram commands, so the audit trail is
identical.

`PANEL_TOKEN` is a **shared secret, not authentication**. It exists to make the
pilot usable before the real inbox with login arrives. Without `PANEL_TOKEN` the
panel returns 404.

The doctors can also see the agenda from Telegram, without opening anything:

```
4                # agenda de hoje
agenda amanhã
agenda 09/11
agenda sexta
```

## Phase 2 boundaries

- Scheduling, rescheduling and cancellation are implemented against the internal
  agenda, with PostgreSQL exclusion constraints and `UNKNOWN` reconciliation.
- `npm run seed:scheduling` loads the fictional catalog and working hours into the
  pilot clinic. The catalog is a hypothesis until the partners validate it.
- `npm run reconcile` releases expired locks and reconciles `UNKNOWN` operations.
- Google Calendar is an adapter; the default is the deterministic fake. Wiring a
  real Google account requires OAuth/service-account configuration.
- Reminders, WhatsApp Cloud API, real owner delivery and the panel remain Phase 3+.

## Scheduling demo

With the API running and the scheduling seed applied:

1. Send `quero marcar limpeza`.
2. The bot lists three slots; reply `1`.
3. Reply `SIM` to confirm.
4. Send `quero remarcar`, then answer the identity prompt with
   `Maria Silva, 10/05/1990`, choose a slot and reply `SIM`.
5. Send `quero cancelar`, answer the identity prompt, and reply `SIM` only when
   you really want to cancel.

The demo identity exists only if the contact is linked to a patient with that
name and birth date. The automated E2E test seeds it.

## Demo helpers

Telegram sends `/start` on the first tap. It is treated as a greeting, so it does
not open a ticket.

An open ticket is a **queued task, not a takeover**. The bot keeps answering
safe administrative intents (FAQ, scheduling, reschedule, cancel, list) while
nobody accepted the ticket. Only an explicit acceptance turns the conversation
into `HUMAN_ACTIVE` and silences the bot. Emergency still sends the protocol, and
a clinical signal upgrades the open ticket (`reclassified` event) so the clinic
record is not lost.

The SLA guarantee: if nobody accepts by `sla_due_at`, the bot sends the patient a
safe next step instead of silence. `npm run sla:sweep` is the job body; schedule
it with any cron runner (Phase 3 wires it into a worker).

```powershell
# A human takes over (bot goes quiet) / closes the ticket (bot resumes)
npm run ticket -- accept <externalUserId> [userId]
npm run ticket -- resolve <externalUserId>

# Sends the SLA fallback for overdue, unaccepted tickets
npm run sla:sweep
```

## Owner notifications

When a ticket is created the bot sends a structured card to every clinic user
that has a linked channel id:

```
[TICKET #ab12cd34] Paciente: Maria
Motivo: Relato clínico
Pedido: "Estou com dor de dente"
Prazo: 14:32

1) Assumir a conversa
2) Encerrar o ticket
3) Responder ao paciente (envie: 3 sua mensagem)
Responda com o número.
```

The dentist answers the bot, never the patient directly. A linked id is always
treated as staff, so use a separate Telegram account for the demo.

```powershell
# This Telegram id becomes staff and receives the cards
npm run owner -- link <telegramUserId> [ownerName]

# Back to being treated as a patient
npm run owner -- unlink <telegramUserId>
```

Linking an id also re-sends the card for the current open ticket, so the demo
works even if the ticket already existed.

## Worker and reminders

`npm run worker` runs the recurring jobs every `WORKER_INTERVAL_MS` (default 60s)
under a Postgres advisory lock, so it is safe to start more than one:

| Job | What it does |
|---|---|
| `sla` | sends the fallback for overdue, unaccepted tickets |
| `reminders` | sends the 24h reminder and records it |
| `idle` | warns the owners when an accepted ticket has no reply for `IDLE_ASSUMED_MINUTES` |
| `reconcile` | releases expired locks, reconciles `UNKNOWN` operations |

The reminder is eligible when the appointment starts between
`REMINDER_MIN_LEAD_HOURS` and `REMINDER_MAX_LEAD_HOURS` from now (default 20–28).
A 09:15 appointment is reminded around 09:15 the day before, and the wide window
survives a few hours of downtime. `appointment_reminders` has a unique key on
`(appointment_id, kind)`, so the same appointment is never reminded twice.

The patient answers the reminder directly:

- `SIM` → `confirmation_status = CONFIRMED` and a confirmation reply;
- `CANCELAR` / "não vou poder" → the normal cancel flow (identity required);
- silence is **not** confirmation: the appointment stays `PENDING` and shows up in
  the daily attendance closing.

```powershell
# Recurring jobs (separate process)
npm run worker
```

## Attendance closing and metrics

The pilot's north-star metric only exists if attendance is closed.

```powershell
# Day list: time, patient, service, status, confirmation, attendance
npm run attendance -- list 2026-11-09

# One appointment at a time (full id or a unique prefix)
npm run attendance -- mark b73416ec ATTENDED
npm run attendance -- mark b73416ec NO_SHOW

# Period metrics
npm run attendance -- summary 2026-11-01 2026-11-30
```

Rules:

- only a past appointment can be closed; a future one is rejected;
- a cancelled or `RESCHEDULE_PENDING` appointment has no attendance;
- `ATTENDED` sets `status = COMPLETED`, `NO_SHOW` sets `status = NO_SHOW`;
- a late cancellation is `LATE_CANCELLED` and **never** counts as a no-show;
- `noShowRate = faltas / (atendidos + faltas)`; silence stays `PENDING` and is
  visible in the list until someone closes it.

Two destructive demo CLIs exist only for repeatable demos. Both refuse to run
with `NODE_ENV=production`.

```powershell
# Back to a fresh conversation: cancels open tickets, clears scheduling context
npm run demo:reset -- <externalUserId>

# Links the contact to a patient so reschedule/cancel can pass identity
npm run demo:link-patient -- <externalUserId> "Maria Silva" 1990-05-10
```

`<externalUserId>` is the Telegram user id, stored in
`patient_contacts.external_user_id`.

## Phase 1 boundaries

- Scheduling, rescheduling, cancellation, reminders, WhatsApp Cloud API and the
  panel are Phase 2+.
- Owner notification is persisted as `ticket_events` in Phase 1; real delivery
  to the dentists is Phase 3.
- Webhook processing is in-request in Phase 1. The `webhook_events` row is
  written before processing, so a crash leaves a reprocessable event; the
  worker arrives in Phase 3.
- `audit_logs` is append-only.
