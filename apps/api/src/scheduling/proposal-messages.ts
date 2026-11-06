import { pick } from '../common/message-style';
import { formatSlot, numbered } from './scheduling-messages';
import { OfferedSlot } from './types';

export const proposalMessages = {
  offer: (
    serviceName: string,
    currentWhen: string,
    slots: OfferedSlot[],
    timezone: string,
  ): string =>
    pick([
      `Precisamos remarcar seu horário de ${serviceName} (${currentWhen}).\n` +
        `Tenho estas opções:\n${numbered(slots, timezone)}\n\n` +
        'Responda com o número. Se preferir, responda CANCELAR.',
      `Oi! Seu horário de ${serviceName} em ${currentWhen} precisa mudar.\n` +
        `Estas opções estão livres:\n${numbered(slots, timezone)}\n\n` +
        'Me diz o número ou escreva CANCELAR.',
    ]),

  askAgain: (slots: OfferedSlot[], timezone: string): string =>
    `Só preciso do número de uma das opções:\n${numbered(slots, timezone)}`,

  conflict: (slots: OfferedSlot[], timezone: string): string =>
    `Esse horário acabou de ser ocupado. Estas ainda estão livres:\n${numbered(slots, timezone)}\n\nQual prefere?`,

  expired: (): string =>
    'Essa proposta de remarcação expirou. Vou pedir para a equipe te ajudar.',

  kept: (): string => 'Tudo bem, mantive sua consulta como estava.',

  rescheduled: (startAt: string, timezone: string): string =>
    `Remarcado! Novo horário: ${formatSlot(startAt, timezone)}.`,
};
