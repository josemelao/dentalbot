import { pick, withEmoji } from '../common/message-style';
import { OfferedSlot } from './types';

const formatSlot = (iso: string, timezone: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(/\./g, '')
    .replace(/,\s*/g, ' ')
    .replace(/(\d{2}:\d{2})$/, 'às $1');

const numbered = (slots: OfferedSlot[], timezone: string): string =>
  slots
    .map((slot, index) => `${index + 1}) ${formatSlot(slot.startAt, timezone)}`)
    .join('\n');

const listBlock = (slots: OfferedSlot[], timezone: string): string =>
  `${numbered(slots, timezone)}`;

export const schedulingMessages = {
  askService: (names: string[]): string =>
    pick([
      `Qual serviço você precisa? Tenho: ${names.join(', ')}.`,
      `Claro! Me conta o que você precisa: ${names.join(', ')}.`,
      `O que você está pensando? Posso ajudar com ${names.join(', ')}.`,
    ]),

  offerSlots: (serviceName: string, slots: OfferedSlot[], timezone: string): string =>
    pick([
      `Tenho estes horários para ${serviceName}:\n${listBlock(slots, timezone)}\nResponda com o número.`,
      `Achei estas opções para ${serviceName}:\n${listBlock(slots, timezone)}\n\nMe diz o número ou o dia que prefere.`,
      `Consegui estes horários para ${serviceName} ${withEmoji('', '👇')}\n${listBlock(slots, timezone)}\n\nQual fica melhor?`,
    ]),

  askNumber: (slots: OfferedSlot[], timezone: string): string =>
    pick([
      `Responda com o número de uma das opções:\n${listBlock(slots, timezone)}`,
      `Não peguei qual você quis. Me diz o número:\n${listBlock(slots, timezone)}`,
      `Só preciso do número da opção:\n${listBlock(slots, timezone)}`,
    ]),

  confirm: (serviceName: string, slot: OfferedSlot, timezone: string): string =>
    pick([
      `Confirma ${serviceName} em ${formatSlot(slot.startAt, timezone)}? Responda SIM ou NÃO.`,
      `Fechado: ${serviceName} em ${formatSlot(slot.startAt, timezone)}. Posso confirmar? (SIM ou NÃO)`,
      `Então fica ${serviceName} em ${formatSlot(slot.startAt, timezone)}. Confirma? SIM ou NÃO.`,
    ]),

  confirmAgain: (): string =>
    pick([
      'Confirma? Responda SIM ou NÃO.',
      'Só confirmando: pode ser? (SIM ou NÃO)',
      'Preciso de um SIM ou NÃO para reservar.',
    ]),

  booked: (serviceName: string, slot: OfferedSlot, timezone: string): string =>
    pick([
      `Agendado! ${serviceName} em ${formatSlot(slot.startAt, timezone)}. Até lá.`,
      withEmoji(
        `Prontinho! ${serviceName} em ${formatSlot(slot.startAt, timezone)}. Te espero lá.`,
        '✅',
      ),
      `Tudo certo: ${serviceName} em ${formatSlot(slot.startAt, timezone)}. Até breve!`,
    ]),

  confirmedAppointment: (
    serviceName: string,
    startAt: string,
    timezone: string,
  ): string =>
    pick([
      `Presença confirmada: ${serviceName} em ${formatSlot(startAt, timezone)}. Até lá.`,
      `Perfeito, confirmei sua presença: ${serviceName} em ${formatSlot(startAt, timezone)}.`,
      withEmoji(
        `Confirmado! ${serviceName} em ${formatSlot(startAt, timezone)}. Até lá.`,
        '👍',
      ),
    ]),

  conflict: (slots: OfferedSlot[], timezone: string): string =>
    pick([
      `Esse horário acabou de ser ocupado. Tenho estas opções:\n${listBlock(slots, timezone)}\nResponda com o número.`,
      `Alguém pegou esse horário agora. Estas ainda estão livres:\n${listBlock(slots, timezone)}\n\nQual prefere?`,
    ]),

  unknownConfirmation: (): string =>
    'Recebi sua confirmação, mas preciso verificar a agenda antes de garantir. Vou confirmar com a equipe e te respondo em até 15 minutos.',

  askIdentity: (): string =>
    pick([
      'Para confirmar, qual seu nome completo e data de nascimento?',
      'Só preciso confirmar seus dados: nome completo e data de nascimento.',
      'Antes de seguir, me diz seu nome completo e a data de nascimento.',
    ]),

  identityMismatch: (): string =>
    'Não consegui confirmar seus dados. Vou pedir para a equipe te ajudar.',

  identityFormat: (): string =>
    pick([
      'Preciso do nome completo e da data de nascimento. Ex.: Maria Silva, 10/05/1990.',
      'Me manda assim: nome completo e data de nascimento (ex.: Maria Silva, 10/05/1990).',
    ]),

  noPatientRecord: (): string =>
    'Não encontrei seus dados para confirmar. Vou pedir para a equipe te ajudar.',

  confirmCancel: (startAt: string, timezone: string): string =>
    pick([
      `Confirma o cancelamento da consulta de ${formatSlot(startAt, timezone)}? Responda SIM ou NÃO.`,
      `Quer mesmo cancelar ${formatSlot(startAt, timezone)}? Responda SIM ou NÃO.`,
    ]),

  rescheduled: (startAt: string, timezone: string): string =>
    pick([
      `Remarcado! Novo horário: ${formatSlot(startAt, timezone)}.`,
      `Pronto, mudei para ${formatSlot(startAt, timezone)}.`,
      withEmoji(`Remarcado para ${formatSlot(startAt, timezone)}.`, '✅'),
    ]),

  keepAppointment: (): string =>
    pick([
      'Tudo bem, mantive sua consulta.',
      'Sem problema, deixei como estava.',
    ]),

  expired: (): string =>
    pick([
      'Essa conversa expirou. Vamos começar de novo: qual serviço você precisa?',
      'Fiquei um tempo sem resposta e a conversa expirou. Me diz de novo o que você precisa?',
    ]),

  noAppointment: (): string =>
    'Não encontrei um agendamento futuro para este contato. Vou pedir para a equipe te ajudar.',

  noUpcomingAppointments: (): string =>
    pick([
      'Não encontrei atendimentos futuros para você. Se quiser marcar, é só dizer "quero agendar".',
      'Você não tem atendimentos futuros. Quer que eu veja um horário?',
    ]),

  listAppointments: (
    items: Array<{ serviceName: string; startAt: string }>,
    timezone: string,
  ): string =>
    pick([
      `Seus próximos atendimentos:\n${items
        .map(
          (item, index) =>
            `${index + 1}) ${item.serviceName} — ${formatSlot(item.startAt, timezone)}`,
        )
        .join('\n')}`,
      `Achei estes agendamentos:\n${items
        .map(
          (item, index) =>
            `${index + 1}) ${item.serviceName} — ${formatSlot(item.startAt, timezone)}`,
        )
        .join('\n')}`,
    ]),

  multipleAppointments: (): string =>
    'Encontrei mais de um agendamento futuro. Vou pedir para a equipe te ajudar a escolher qual remarcar ou cancelar.',

  noSlots: (serviceName: string): string =>
    pick([
      `Não encontrei horários para ${serviceName} nos próximos dias. Vou pedir para a equipe te ajudar.`,
      `A agenda de ${serviceName} está cheia nos próximos dias. Vou pedir para a equipe te ajudar.`,
    ]),

  evaluationIntro: (serviceName: string): string =>
    pick([
      `Para ${serviceName}, o próximo passo é uma avaliação. `,
      `Antes de ${serviceName}, precisamos de uma avaliação. `,
    ]),

  noEvaluation: (): string =>
    'Esse procedimento precisa de avaliação, mas não há avaliação configurada. Vou pedir para a equipe te ajudar.',

  noLocation: (): string =>
    'Não encontrei uma unidade ativa. Vou pedir para a equipe te ajudar.',

  cancelled: (late: boolean): string =>
    late
      ? 'Cancelamento registrado. Como foi com menos de 24h, fica registrado como cancelamento tardio.'
      : pick([
          'Cancelamento registrado. Obrigado por avisar.',
          'Pronto, cancelei. Obrigado por avisar!',
        ]),
};
