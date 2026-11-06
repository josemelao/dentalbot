import { DateTime } from 'luxon';
import { PanelData } from './panel.service';

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

const agendaRows = (data: PanelData): string => {
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

const ticketRows = (data: PanelData): string => {
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
        <td class="mono">#${ticket.id.slice(0, 8)}</td>
        <td>${escape(REASON[ticket.reason] ?? ticket.reason)}</td>
        <td>${escape(ticket.patientLabel)}<div class="muted">${escape(ticket.question.slice(0, 120))}</div></td>
        <td><span class="badge ${state}">${escape(state)}</span><div class="muted">SLA ${deadline}</div></td>
      </tr>`;
    })
    .join('');
};

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
      <thead><tr><th>Hora</th><th>Serviço</th><th>Paciente</th><th>Status</th></tr></thead>
      <tbody>${agendaRows(data)}</tbody>
    </table>
  </section>
  <section>
    <h2>Tickets abertos</h2>
    <table>
      <thead><tr><th>Ticket</th><th>Motivo</th><th>Paciente</th><th>Situação</th></tr></thead>
      <tbody>${ticketRows(data)}</tbody>
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
</main>
</body>
</html>`;
}
