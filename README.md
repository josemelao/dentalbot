# Dental Assistant

Secretária virtual administrativa para clínicas odontológicas. Responde o que
uma recepcionista responderia, agenda, remarca, cancela, lembra e escala para um
humano quando a pergunta é clínica ou desconhecida. **Nunca diagnostica, prescreve
ou interpreta exames.**

---

## O que ele faz

| Capacidade | Como |
|---|---|
| FAQ administrativa | resposta **verbatim** de `knowledge_entries` aprovadas |
| Agendamento | serviço → horários → confirmação, com motor de slots real |
| Remarcação | iniciada pelo paciente (com identidade) ou **proposta pela clínica** |
| Cancelamento | com política de 24h e `LATE_CANCELLED` |
| Lembretes | 24h antes, com confirmação ativa |
| Escalonamento | ticket com card, SLA, fallback e alerta de ociosidade |
| Segurança | triagem determinística; emergência vence tudo |
| Painel | agenda, tickets com histórico, FAQ, preços, horários, mensagens |
| Modo sombra | o bot rascunha, o humano aprova antes de enviar |

---

## Arquitetura

```
Telegram ──webhook──> API (NestJS)
                        │
                        ├─ triagem de segurança (determinística)
                        ├─ regras de intenção (grátis)
                        ├─ roteador LLM (só no UNKNOWN, devolve ROTA)
                        ├─ fluxo de agendamento + motor de slots
                        ├─ tickets, SLA, notificação aos sócios
                        └─ Postgres (fonte de verdade)
                        │
Worker (processo separado)
  ├─ sla        fallback ao paciente
  ├─ reminders  lembrete 24h
  ├─ idle       alerta de ticket assumido e parado
  ├─ calendar   detecta evento apagado/movido no Google
  └─ reconcile  locks expirados e operações UNKNOWN
```

**Princípio central:** a IA classifica e roteia; ela **não escreve fatos**. Toda
resposta administrativa vem de um registro aprovado ou de um dado estruturado.

---

## Stack

- Node.js + TypeScript
- NestJS (API + painel server-rendered)
- PostgreSQL 16 (Docker)
- Luxon, Zod, pg
- Jest + Supertest
- Telegram Bot API (WhatsApp é Fase 4)

---

## Como rodar

```bash
docker compose up -d

cd apps/api
npm install
cp .env.example .env      # preencha os valores
npm run migrate
npm run seed
npm run seed:scheduling
npm run dev               # API
```

Em outro terminal:

```bash
cd apps/api
npm run worker            # jobs periódicos
```

### Variáveis essenciais

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/dental_assistant
CHANNEL_TRANSPORT=telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
AI_PROVIDER=fake          # fake | openai | gemini
PANEL_TOKEN=              # bootstrap do painel fora de produção
SESSION_SECRET=           # obrigatório para o login do painel
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_CLINIC_CALENDAR_ID=
```

Nunca commite o `.env` nem a chave da service account (`secrets/` está no
`.gitignore`).

---

## Replicar em outra máquina

O repositório traz **código + schema + seeds**. O banco é recriado do zero; os
dados reais **não** vêm no clone.

### O que transferir manualmente

| Arquivo | Por quê |
|---|---|
| `apps/api/.env` | tokens, segredos e caminhos (gitignored) |
| `secrets/<service-account>.json` | chave do Google (gitignored) |
| `backup.sql` (opcional) | só se quiser os mesmos dados |

Tudo o mais — código, migrations, seeds, docs, `docker-compose.yml`,
`.env.example` — já está no Git.

### Passo a passo

Pré-requisitos: **Node 20+**, **Docker Desktop**, **git**.

```bash
git clone https://github.com/josemelao/dentalbot.git
cd dentalbot
docker compose up -d

cd apps/api
npm install
cp .env.example .env        # depois preencha os valores
npm run migrate             # cria o schema (0001..0022)
npm run seed                # clínica fictícia + FAQ
npm run seed:scheduling     # profissionais, serviços, horários
npm run user:password -- chow@example.com "sua senha"
npm run dev                 # API em :3000
```

Em outro terminal:

```bash
cd apps/api
npm run worker              # jobs: sla, reminders, idle, calendar, reconcile
```

Testes (o banco de teste é criado e migrado automaticamente):

```bash
cd apps/api
npm test
```

### Quer os mesmos dados?

```bash
# na máquina antiga
docker exec novapasta-db-1 pg_dump -U postgres -d dental_assistant > backup.sql

# na nova, depois do docker compose up
docker exec -i novapasta-db-1 psql -U postgres -d dental_assistant < backup.sql
```

O dump traz conversas, tickets, agendamentos, FAQ editada e as senhas do painel.

### O que quebra no PC novo

| Sintoma | Causa | Correção |
|---|---|---|
| Bot não responde | webhook aponta para o túnel antigo | refazer o `setWebhook` com a URL nova |
| Google `403` | `secrets/` ausente ou caminho errado no `.env` | copiar o JSON e ajustar o caminho |
| Login do painel falha | banco novo, sem senha | rodar `user:password` de novo |
| `npm test` falha | Postgres não está de pé | `docker compose up -d` |

> O seed é idempotente (reaproveita a clínica "Clínica Piloto"), mas o tenant id
> é gerado de novo num banco vazio.

---

## Painel

```
http://localhost:3000/painel/login
```

Login por e-mail e senha (sessão assinada em cookie, 8h). Para definir a senha:

```bash
npm run user:password -- chow@example.com "uma senha forte"
```

O painel tem: agenda do dia, tickets com histórico completo e não lidas,
respostas pendentes (modo sombra), horários, feriados, férias, serviços, FAQ e
mensagens do bot.

---

## Comandos

| Comando | Para quê |
|---|---|
| `npm run migrate` | aplica migrations |
| `npm run seed` | clínica fictícia + FAQ |
| `npm run seed:scheduling` | catálogo e agenda |
| `npm run worker` | jobs periódicos |
| `npm run user:password -- <email> <senha>` | senha do painel |
| `npm run attendance -- list [data]` | lista do dia |
| `npm run attendance -- mark <id> <ATTENDED\|NO_SHOW>` | fechamento |
| `npm run attendance -- summary <de> <até>` | métricas |
| `npm run ticket -- accept\|resolve <externalUserId>` | ciclo do ticket |
| `npm run owner -- link\|unlink <id>` | vincula sócio ao bot |
| `npm run sla:sweep` | fallback de SLA avulso |
| `npm run reconcile` | reconciliação de `UNKNOWN` |

---

## Testes

```bash
cd apps/api
npm test          # 52 suites / 270 testes
npm run build
npm run lint
```

Os testes de integração usam um Postgres real (`TEST_DATABASE_URL`) e aplicam as
migrations automaticamente.

---

## Segurança e LGPD

- `tenant_id` vem do canal (`clinic_channels`), nunca do texto ou da IA.
- Toda leitura/escrita de dados do tenant filtra por `tenant_id`.
- Emergência tem protocolo fixo e **não é editável** no painel.
- Respostas administrativas são rastreáveis a uma entrada vigente.
- Logs mascaram telefone e removem corpo de mensagem.
- O painel exige sessão; o `PANEL_TOKEN` só vale fora de produção.

---

## Google Calendar

O adaptador é **bidirecional**:

- **escreve** as consultas no calendário da clínica;
- **lê free/busy** do calendário pessoal de cada profissional (só ocupado/livre,
  sem títulos);
- **detecta** evento apagado ou movido fora do bot → marca `RESCHEDULE_REQUIRED`,
  libera o slot e **alerta a clínica** (não fala com o paciente sozinho).

Setup: service account com acesso ao calendário da clínica (*fazer alterações*) e
aos calendários pessoais (*ver apenas disponibilidade*). O `calendar_id` pessoal
fica em `professionals.calendar_id`.

---

## Estrutura

```
apps/api/src
  ai/            gateway de intenção, roteador de UNKNOWN, clientes LLM
  calendar/      adaptadores fake e Google
  channels/      adaptadores de canal, notifier dos sócios
  db/            repositórios e migrations de acesso
  messages/      templates editáveis
  panel/         painel (login, agenda, tickets, configuração)
  pipeline/      inbound, segurança, FAQ, escalonamento, SLA, sombra
  scheduling/    motor de slots, booking, lembretes, propostas
  worker/        jobs periódicos
supabase/migrations
docs/
```

---

## Status

| Fase | Estado |
|---|---|
| 0–1 Fundação, inbound, identidade, FAQ | ✅ |
| 2 Agenda, booking, remarcação, cancelamento | ✅ |
| 3 Escalonamento, SLA, lembretes, presença | ✅ |
| 4 WhatsApp Cloud API | pendente |
| 5 Painel completo, métricas | parcial ✅ |
| 6 Piloto e hardening | pendente |

---

## Licença

Uso privado.
