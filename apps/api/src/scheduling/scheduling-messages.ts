import { OfferedSlot } from './types';

const formatSlot = (iso: string, timezone: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

const numbered = (slots: OfferedSlot[], timezone: string): string =>
  slots
    .map((slot, index) => `${index + 1}) ${formatSlot(slot.startAt, timezone)}`)
    .join('\n');

export const schedulingMessages = {
  askService: (names: string[]): string =>
    `Qual serviço você precisa? Tenho: ${names.join(', ')}.`,

  offerSlots: (serviceName: string, slots: OfferedSlot[], timezone: string): string =>
    `Tenho estes horários para ${serviceName}:\n${numbered(slots, timezone)}\nResponda com o número.`,

  askNumber: (slots: OfferedSlot[], timezone: string): string =>
    `Responda com o número de uma das opções:\n${numbered(slots, timezone)}`,

  confirm: (serviceName: string, slot: OfferedSlot, timezone: string): string =>
    `Confirma ${serviceName} em ${formatSlot(slot.startAt, timezone)}? Responda SIM ou NÃO.`,

  confirmAgain: (): string => 'Confirma? Responda SIM ou NÃO.',

  booked: (serviceName: string, slot: OfferedSlot, timezone: string): string =>
    `Agendado! ${serviceName} em ${formatSlot(slot.startAt, timezone)}. Até lá.`,

  conflict: (slots: OfferedSlot[], timezone: string): string =>
    `Esse horário acabou de ser ocupado. Tenho estas opções:\n${numbered(slots, timezone)}\nResponda com o número.`,

  unknownConfirmation: (): string =>
    'Recebi sua confirmação, mas preciso verificar a agenda antes de garantir. Vou confirmar com a equipe e te respondo em até 15 minutos.',

  askIdentity: (): string =>
    'Para confirmar, qual seu nome completo e data de nascimento?',

  identityMismatch: (): string =>
    'Não consegui confirmar seus dados. Vou pedir para a equipe te ajudar.',

  identityFormat: (): string =>
    'Preciso do nome completo e da data de nascimento. Ex.: Maria Silva, 10/05/1990.',

  noPatientRecord: (): string =>
    'Não encontrei seus dados para confirmar. Vou pedir para a equipe te ajudar.',

  confirmCancel: (startAt: string, timezone: string): string =>
    `Confirma o cancelamento da consulta de ${formatSlot(startAt, timezone)}? Responda SIM ou NÃO.`,

  rescheduled: (startAt: string, timezone: string): string =>
    `Remarcado! Novo horário: ${formatSlot(startAt, timezone)}.`,

  keepAppointment: (): string => 'Tudo bem, mantive sua consulta.',

  expired: (): string =>
    'Essa conversa expirou. Vamos começar de novo: qual serviço você precisa?',

  noAppointment: (): string =>
    'Não encontrei um agendamento futuro para este contato. Vou pedir para a equipe te ajudar.',

  multipleAppointments: (): string =>
    'Encontrei mais de um agendamento futuro. Vou pedir para a equipe te ajudar a escolher qual remarcar ou cancelar.',

  noSlots: (serviceName: string): string =>
    `Não encontrei horários para ${serviceName} nos próximos dias. Vou pedir para a equipe te ajudar.`,

  evaluationIntro: (serviceName: string): string =>
    `Para ${serviceName}, o próximo passo é uma avaliação. `,

  noEvaluation: (): string =>
    'Esse procedimento precisa de avaliação, mas não há avaliação configurada. Vou pedir para a equipe te ajudar.',

  noLocation: (): string =>
    'Não encontrei uma unidade ativa. Vou pedir para a equipe te ajudar.',

  cancelled: (late: boolean): string =>
    late
      ? 'Cancelamento registrado. Como foi com menos de 24h, fica registrado como cancelamento tardio.'
      : 'Cancelamento registrado. Obrigado por avisar.',
};
