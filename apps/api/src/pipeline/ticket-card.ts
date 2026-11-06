import { HumanTicket, TicketReason } from '../db/repositories/rows';

const REASON_LABEL: Record<TicketReason, string> = {
  EMERGENCY: 'EMERGÊNCIA',
  CLINICAL: 'Relato clínico',
  HUMAN_REQUEST: 'Pedido de atendimento humano',
  UNKNOWN: 'Dúvida sem resposta aprovada',
};

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

/** Never expose the full external id in a card that may be forwarded. */
export function formatPatientLabel(
  displayName: string | null | undefined,
  externalUserId: string,
): string {
  const name = displayName?.trim();
  if (name) return name;
  const tail = externalUserId.slice(-4);
  return `contato •••${tail}`;
}

export interface TicketCardOptions {
  timezone?: string;
}

export function formatTicketCard(
  ticket: HumanTicket,
  patientLabel: string,
  options: TicketCardOptions = {},
): string {
  const deadline = new Intl.DateTimeFormat('pt-BR', {
    timeZone: options.timezone ?? 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ticket.slaDueAt);

  return [
    `[TICKET #${ticket.id.slice(0, 8)}] Paciente: ${patientLabel}`,
    `Motivo: ${REASON_LABEL[ticket.reason]}`,
    `Pedido: "${truncate(ticket.question, 200)}"`,
    `Prazo: ${deadline}`,
    '',
    '1) Assumir a conversa',
    '2) Encerrar o ticket',
    '3) Responder ao paciente (envie: 3 sua mensagem)',
    'Responda com o número.',
  ].join('\n');
}
