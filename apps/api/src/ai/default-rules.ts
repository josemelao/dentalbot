import { FakeAiRule } from './fake-ai.gateway';

export const DEFAULT_AI_RULES: FakeAiRule[] = [
  // Telegram clients send /start on the very first tap. Treating it as UNKNOWN
  // would open a ticket and silence the bot for the rest of the conversation.
  { when: /^\/(start|help|menu|iniciar|comecar)\b/i, intent: 'GREETING' },
  { when: /hor[aá]rio|funcionamento|que horas abre/i, intent: 'FAQ_ADMIN' },
  { when: /endere[cç]o|onde fica/i, intent: 'FAQ_ADMIN' },
  { when: /conv[eê]nio/i, intent: 'FAQ_ADMIN' },
  { when: /remarcar|reagendar/i, intent: 'RESCHEDULE_REQUEST' },
  { when: /cancelar/i, intent: 'CANCEL_REQUEST' },
  { when: /agendar|marcar/i, intent: 'SCHEDULE_REQUEST' },
  { when: /\bdor\b|inflamad|sangr/i, intent: 'CLINICAL_QUESTION' },
  { when: /falar com (o )?dentista|humano|atendente/i, intent: 'HUMAN_REQUEST' },
  { when: /^(oi|ol[aá]|bom dia|boa tarde|boa noite)/i, intent: 'GREETING' },
];
