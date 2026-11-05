import { FakeAiRule } from './fake-ai.gateway';

export const DEFAULT_AI_RULES: FakeAiRule[] = [
  { when: /hor[aá]rio|funcionamento|que horas abre/i, intent: 'FAQ_ADMIN' },
  { when: /endere[cç]o|onde fica/i, intent: 'FAQ_ADMIN' },
  { when: /conv[eê]nio/i, intent: 'FAQ_ADMIN' },
  { when: /agendar|marcar|remarcar|cancelar/i, intent: 'SCHEDULE_REQUEST' },
  { when: /\bdor\b|inflamad|sangr/i, intent: 'CLINICAL_QUESTION' },
  { when: /falar com (o )?dentista|humano|atendente/i, intent: 'HUMAN_REQUEST' },
  { when: /^(oi|ol[aá]|bom dia|boa tarde|boa noite)/i, intent: 'GREETING' },
];
