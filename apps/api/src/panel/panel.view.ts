import { DateTime } from 'luxon';
import { PanelData, TicketDetail } from './panel.service';

const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const REASON: Record<string, string> = {
  EMERGENCY: 'Emergência',
  CLINICAL: 'Clínico',
  HUMAN_REQUEST: 'Pediu humano',
  UNKNOWN: 'Dúvida',
};

const shiftDay = (dateISO: string, days: number, timezone: string): string =>
  DateTime.fromISO(dateISO, { zone: timezone }).plus({ days }).toISODate() ?? dateISO;

const agendaRows = (data: PanelData, token: string): string => {
  const visible = data.agenda.filter(
    (row) => row.status !== 'CANCELLED' && row.status !== 'RESCHEDULE_PENDING',
  );
  if (visible.length === 0) {
    return '<tr><td colspan="4" class="empty">Nenhum atendimento neste dia.</td></tr>';
  }

  return visible
    .map((row) => {
      const time = DateTime.fromJSDate(row.startAt).setZone(data.timezone).toFormat('HH:mm');
      const confirmation =
        row.attendanceStatus !== 'PENDING'
          ? row.attendanceStatus
          : row.confirmationStatus;
      return `<tr>
        <td class="time">${time}</td>
        <td>${escape(row.serviceName)}</td>
        <td>${escape(row.patientLabel)}</td>
        <td><span class="badge ${confirmation.toLowerCase()}">${escape(confirmation)}</span></td>
        <td>
          <form method="post" action="/painel/agendamentos/${row.id}/confirmar">
            <input type="hidden" name="token" value="${escape(token)}">
            <button type="submit" class="ghost">pedir confirmação</button>
          </form>
          <form method="post" action="/painel/agendamentos/${row.id}/propor">
            <input type="hidden" name="token" value="${escape(token)}">
            <button type="submit" class="ghost">propor remarcação</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');
};

const faqRows = (data: PanelData, token: string): string => {
  if (data.knowledge.length === 0) {
    return '<tr><td colspan="4" class="empty">Nenhuma entrada ainda.</td></tr>';
  }

  return data.knowledge
    .map((entry) => {
      const formId = `faq-${entry.id}`;
      return `<tr>
        <td>${escape(entry.question)}<div class="muted">${escape(entry.category)}</div></td>
        <td><textarea form="${formId}" name="answer" rows="2">${escape(entry.answer)}</textarea></td>
        <td><input form="${formId}" name="keywords" value="${escape(entry.keywords.join(', '))}"></td>
        <td>
          <select form="${formId}" name="status">
            ${['draft', 'approved', 'retired']
              .map(
                (status) =>
                  `<option value="${status}"${entry.status === status ? ' selected' : ''}>${status}</option>`,
              )
              .join('')}
          </select>
          <form id="${formId}" method="post" action="/painel/faq/${entry.id}">
            <input type="hidden" name="token" value="${escape(token)}">
            <button type="submit">salvar</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');
};

const serviceRows = (data: PanelData, token: string): string => {
  if (data.services.length === 0) {
    return '<tr><td colspan="5" class="empty">Nenhum serviço cadastrado.</td></tr>';
  }

  return data.services
    .map((service) => {
      const formId = `svc-${service.id}`;
      return `<tr>
        <td>${escape(service.name)}</td>
        <td><input form="${formId}" name="durationMinutes" type="number" min="5" step="5" value="${service.durationMinutes}" class="short"></td>
        <td><input form="${formId}" name="price" type="number" min="0" step="10" value="${Number(service.price)}" class="short"></td>
        <td><input form="${formId}" name="priceDisclosureAllowed" type="checkbox"${service.priceDisclosureAllowed ? ' checked' : ''}></td>
        <td>
          <select form="${formId}" name="status">
            ${['active', 'inactive']
              .map(
                (status) =>
                  `<option value="${status}"${service.status === status ? ' selected' : ''}>${status}</option>`,
              )
              .join('')}
          </select>
          <form id="${formId}" method="post" action="/painel/servicos/${service.id}">
            <input type="hidden" name="token" value="${escape(token)}">
            <button type="submit">salvar</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');
};

const templateRows = (data: PanelData, token: string): string =>
  data.templates
    .map((template) => {
      const formId = `tpl-${template.key.replace(/\W/g, '-')}`;
      const value = escape(template.variants.join('\n'));
      return `<tr>
        <td>
          ${escape(template.label)}
          <div class="muted">${escape(template.key)}${template.edited ? ' · editado' : ''}</div>
        </td>
        <td>
          <textarea form="${formId}" name="variants" rows="3"${template.locked ? ' disabled' : ''}>${value}</textarea>
          <div class="muted">${template.locked ? '🔒 travada — não pode ser alterada' : 'uma variante por linha'}</div>
        </td>
        <td>
          ${
            template.locked
              ? ''
              : `<form id="${formId}" method="post" action="/painel/templates/${encodeURIComponent(template.key)}">
                   <input type="hidden" name="token" value="${escape(token)}">
                   <button type="submit">salvar</button>
                 </form>`
          }
        </td>
      </tr>`;
    })
    .join('');

const ticketRows = (data: PanelData, token: string): string => {
  if (data.tickets.length === 0) {
    return '<tr><td colspan="4" class="empty">Nenhum ticket aberto.</td></tr>';
  }

  return data.tickets
    .map((ticket) => {
      const deadline = DateTime.fromJSDate(ticket.slaDueAt)
        .setZone(data.timezone)
        .toFormat('dd/MM HH:mm');
      const state = ticket.acceptedAt ? 'assumido' : ticket.status;
      return `<tr>
        <td class="mono">
          <a href="/painel/tickets/${ticket.id}?token=${encodeURIComponent(token)}">#${ticket.id.slice(0, 8)}</a>
        </td>
        <td>${escape(REASON[ticket.reason] ?? ticket.reason)}</td>
        <td>
          ${escape(ticket.patientLabel)}
          ${ticket.unreadCount > 0 ? `<span class="badge unread">${ticket.unreadCount} nova(s)</span>` : ''}
          <div class="muted">${escape(ticket.question.slice(0, 120))}</div>
          <form class="reply" method="post" action="/painel/tickets/${ticket.id}/responder">
            <input type="hidden" name="token" value="${escape(token)}">
            <input name="answer" placeholder="responder ao paciente" required>
            <button type="submit">enviar</button>
          </form>
        </td>
        <td>
          <span class="badge ${state}">${escape(state)}</span>
          <div class="muted">SLA ${deadline}</div>
          <div class="actions">
            <form method="post" action="/painel/tickets/${ticket.id}/assumir">
              <input type="hidden" name="token" value="${escape(token)}">
              <button type="submit"${ticket.acceptedAt ? ' disabled' : ''}>assumir</button>
            </form>
            <form method="post" action="/painel/tickets/${ticket.id}/encerrar">
              <input type="hidden" name="token" value="${escape(token)}">
              <button type="submit" class="ghost">encerrar</button>
            </form>
          </div>
        </td>
      </tr>`;
    })
    .join('');
};

export function renderTicket(detail: TicketDetail, token: string): string {
  const { ticket } = detail;
  const deadline = DateTime.fromJSDate(ticket.slaDueAt)
    .setZone(detail.timezone)
    .toFormat('dd/MM HH:mm');

  const messages = detail.messages
    .map((message) => {
      const time = DateTime.fromJSDate(message.createdAt)
        .setZone(detail.timezone)
        .toFormat('dd/MM HH:mm');
      const side = message.direction === 'in' ? 'in' : 'out';
      const who = message.direction === 'in' ? escape(detail.patientLabel) : 'clínica';
      return `<li class="msg ${side}">
        <div class="who">${who} · ${time}</div>
        <div class="bubble">${escape(message.content ?? `[${message.messageType}]`)}</div>
      </li>`;
    })
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Ticket #${ticket.id.slice(0, 8)} — ${escape(detail.patientLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; background:#f6f7f9; color:#111; }
  header { padding:20px 24px; background:#0f172a; color:#fff; display:flex; justify-content:space-between; align-items:center; gap:16px; }
  header h1 { margin:0; font-size:18px; }
  header p { margin:4px 0 0; color:#94a3b8; font-size:13px; }
  header a { color:#93c5fd; text-decoration:none; font-size:13px; }
  main { padding:24px; max-width:900px; margin:0 auto; display:grid; gap:20px; }
  section { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:16px; }
  .meta { display:flex; flex-wrap:wrap; gap:18px; font-size:13px; color:#475569; }
  .meta b { color:#0f172a; }
  ul.msgs { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
  .msg .who { font-size:12px; color:#64748b; margin-bottom:4px; }
  .msg .bubble { padding:10px 14px; border-radius:12px; background:#f1f5f9; display:inline-block; max-width:80%; white-space:pre-wrap; }
  .msg.out { text-align:right; }
  .msg.out .bubble { background:#dbeafe; color:#1e3a8a; }
  form.reply { display:flex; gap:8px; margin-top:16px; }
  form.reply input { flex:1; font:inherit; padding:10px 12px; border:1px solid #d1d5db; border-radius:8px; }
  button { font:inherit; padding:9px 14px; border-radius:8px; border:1px solid #1d4ed8; background:#1d4ed8; color:#fff; cursor:pointer; }
  button.ghost { background:#fff; color:#1d4ed8; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  .actions { display:flex; gap:8px; margin-top:12px; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; background:#e2e8f0; color:#334155; }
  .badge.assumido, .badge.answered { background:#dbeafe; color:#1e40af; }
  .badge.unread { background:#dc2626; color:#fff; margin-left:6px; }
  .empty { color:#94a3b8; }
</style>
</head>
<body>
<header>
  <div>
    <h1>Ticket #${ticket.id.slice(0, 8)} — ${escape(detail.patientLabel)}</h1>
    <p>${escape(ticket.summary)}</p>
  </div>
  <a href="/painel?token=${encodeURIComponent(token)}">← voltar ao painel</a>
</header>
<main>
  <section>
    <div class="meta">
      <span>Motivo: <b>${escape(ticket.reason)}</b></span>
      <span>Situação: <b>${escape(ticket.acceptedAt ? 'assumido' : ticket.status)}</b></span>
      <span>SLA: <b>${deadline}</b></span>
      <span>Pedido original: <b>${escape(ticket.question.slice(0, 140))}</b></span>
    </div>
  </section>

  <section>
    <ul class="msgs">
      ${messages || '<li class="empty">Sem mensagens.</li>'}
    </ul>

    <form class="reply" method="post" action="/painel/tickets/${ticket.id}/responder">
      <input type="hidden" name="token" value="${escape(token)}">
      <input name="answer" placeholder="responder ao paciente…" required autocomplete="off">
      <button type="submit">enviar</button>
    </form>

    <div class="actions">
      <form method="post" action="/painel/tickets/${ticket.id}/assumir">
        <input type="hidden" name="token" value="${escape(token)}">
        <button type="submit"${ticket.acceptedAt ? ' disabled' : ''}>assumir</button>
      </form>
      <form method="post" action="/painel/tickets/${ticket.id}/encerrar">
        <input type="hidden" name="token" value="${escape(token)}">
        <button type="submit" class="ghost">encerrar</button>
      </form>
    </div>
  </section>
</main>
</body>
</html>`;
}

export function renderLogin(error?: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar — painel</title>
<style>
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0f172a;
         font:15px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; color:#0f172a; }
  form { background:#fff; padding:28px; border-radius:12px; width:340px; display:grid; gap:14px; }
  h1 { margin:0 0 4px; font-size:18px; }
  p { margin:0; color:#64748b; font-size:13px; }
  input { font:inherit; padding:10px 12px; border:1px solid #d1d5db; border-radius:8px; width:100%; }
  button { font:inherit; padding:10px 14px; border-radius:8px; border:1px solid #1d4ed8;
           background:#1d4ed8; color:#fff; cursor:pointer; }
  .error { background:#fee2e2; color:#991b1b; padding:8px 12px; border-radius:8px; font-size:13px; }
</style>
</head>
<body>
<form method="post" action="/painel/login">
  <h1>Painel da clínica</h1>
  <p>Entre com seu e-mail e senha.</p>
  ${error ? '<div class="error">E-mail ou senha inválidos.</div>' : ''}
  <input name="email" type="email" placeholder="e-mail" required autocomplete="username">
  <input name="password" type="password" placeholder="senha" required autocomplete="current-password">
  <button type="submit">entrar</button>
</form>
</body>
</html>`;
}

export function renderPanel(data: PanelData, token: string): string {
  const previous = shiftDay(data.dateISO, -1, data.timezone);
  const next = shiftDay(data.dateISO, 1, data.timezone);
  const title = DateTime.fromISO(data.dateISO, { zone: data.timezone })
    .setLocale('pt-BR')
    .toFormat("cccc, dd 'de' LLLL");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>${escape(data.clinicName)} — painel</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; background:#f6f7f9; color:#111; }
  header { padding: 20px 24px; background:#0f172a; color:#fff; }
  header h1 { margin:0; font-size:18px; font-weight:600; }
  header p { margin:4px 0 0; color:#94a3b8; font-size:13px; }
  main { padding: 24px; display:grid; gap:24px; max-width: 1100px; }
  section { background:#fff; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; }
  section h2 { margin:0; padding:14px 16px; font-size:15px; border-bottom:1px solid #e5e7eb; display:flex; justify-content:space-between; align-items:center; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:10px 16px; border-bottom:1px solid #f1f5f9; vertical-align:top; }
  th { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#64748b; background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .time { font-variant-numeric: tabular-nums; font-weight:600; width:70px; }
  .mono { font-family: ui-monospace, Consolas, monospace; color:#475569; }
  .muted { color:#64748b; font-size:12px; }
  .empty { color:#94a3b8; text-align:center; padding:24px; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; background:#e2e8f0; color:#334155; }
  .badge.confirmed, .badge.attended { background:#dcfce7; color:#166534; }
  .badge.no_show { background:#fee2e2; color:#991b1b; }
  .badge.assumido, .badge.answered { background:#dbeafe; color:#1e40af; }
  .badge.unread { background:#dc2626; color:#fff; margin-left:6px; }
  .badge.pending { background:#fef3c7; color:#92400e; }
  nav { display:flex; gap:8px; }
  nav a { color:#1d4ed8; text-decoration:none; font-size:13px; padding:4px 10px; border:1px solid #dbeafe; border-radius:6px; }
  input, select, textarea { font: inherit; padding:6px 8px; border:1px solid #d1d5db; border-radius:6px; width:100%; }
  textarea { resize: vertical; }
  input.short { width: 90px; }
  input[type=checkbox] { width: auto; }
  button { font: inherit; padding:6px 12px; border-radius:6px; border:1px solid #1d4ed8; background:#1d4ed8; color:#fff; cursor:pointer; }
  button:hover { background:#1e40af; }
  form.new { display:grid; grid-template-columns: 120px 1fr 1fr 1fr 110px 90px; gap:8px; padding:14px 16px; border-top:1px solid #e5e7eb; }
  .actions { display:flex; gap:6px; margin-top:8px; }
  .actions form { margin:0; }
  button.ghost { background:#fff; color:#1d4ed8; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  form.reply { display:flex; gap:6px; margin-top:8px; }
  form.reply input { flex:1; }
</style>
</head>
<body>
<header>
  <h1>${escape(data.clinicName)}</h1>
  <p>${escape(title)} · atualiza sozinho a cada 30s</p>
</header>
<main>
  <section>
    <h2>
      Agenda
      <nav>
        <a href="?token=${encodeURIComponent(token)}&date=${previous}">← anterior</a>
        <a href="?token=${encodeURIComponent(token)}&date=${next}">próximo →</a>
      </nav>
    </h2>
    <table>
      <thead><tr><th>Hora</th><th>Serviço</th><th>Paciente</th><th>Status</th><th>Ação</th></tr></thead>
      <tbody>${agendaRows(data, token)}</tbody>
    </table>
  </section>
  <section>
    <h2>Tickets abertos</h2>
    <table>
      <thead><tr><th>Ticket</th><th>Motivo</th><th>Paciente</th><th>Situação</th></tr></thead>
      <tbody>${ticketRows(data, token)}</tbody>
    </table>
  </section>
  <section>
    <h2>FAQ aprovada</h2>
    <table>
      <thead><tr><th>Pergunta</th><th>Resposta (enviada ao paciente)</th><th>Palavras-chave</th><th>Status</th></tr></thead>
      <tbody>${faqRows(data, token)}</tbody>
    </table>
    <form class="new" method="post" action="/painel/faq">
      <input type="hidden" name="token" value="${escape(token)}">
      <input name="category" placeholder="categoria" value="geral">
      <input name="question" placeholder="Pergunta" required>
      <input name="answer" placeholder="Resposta aprovada" required>
      <input name="keywords" placeholder="palavras-chave, separadas por vírgula">
      <select name="status">
        <option value="draft">draft</option>
        <option value="approved">approved</option>
      </select>
      <button type="submit">criar</button>
    </form>
  </section>
  <section>
    <h2>Serviços</h2>
    <table>
      <thead><tr><th>Serviço</th><th>Duração (min)</th><th>Preço</th><th>Mostrar preço</th><th>Status</th></tr></thead>
      <tbody>${serviceRows(data, token)}</tbody>
    </table>
  </section>
  <section>
    <h2>Mensagens do bot</h2>
    <table>
      <thead><tr><th>Mensagem</th><th>Variantes ({{placeholders}} preenchidos pelo sistema)</th><th></th></tr></thead>
      <tbody>${templateRows(data, token)}</tbody>
    </table>
  </section>
</main>
</body>
</html>`;
}
