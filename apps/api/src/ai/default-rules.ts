import { FakeAiRule } from './fake-ai.gateway';

export const DEFAULT_AI_RULES: FakeAiRule[] = [
  // Telegram clients send /start on the very first tap. Treating it as UNKNOWN
  // would open a ticket and silence the bot for the rest of the conversation.
  { when: /^\/(start|help|menu|iniciar|comecar)\b/i, intent: 'GREETING' },
  {
    when: /^(sim|s|confirmo|confirmado|vou sim|estarei|claro)\b/i,
    intent: 'CONFIRM_APPOINTMENT',
  },
  { when: /n[ãa]o vou (poder|conseguir)|n[ãa]o poderei|desmarcar/i, intent: 'CANCEL_REQUEST' },

  // Administrative FAQ. Keep "horário" narrow: "queria um horário" is scheduling.
  {
    when: /hor[aá]rio de (funcionamento|atendimento|voc[eê]s)|qual (o )?hor[aá]rio|que horas (abre|fecha|funciona|voc[eê]s)|funcionamento|abre (no|aos) (s[aá]bado|domingo)/i,
    intent: 'FAQ_ADMIN',
  },
  { when: /endere[cç]o|onde (fica|voc[eê]s ficam|é a cl[ií]nica)/i, intent: 'FAQ_ADMIN' },
  { when: /conv[eê]nio|plano de sa[uú]de|unimed|amil|bradesco sa[uú]de/i, intent: 'FAQ_ADMIN' },
  { when: /quanto custa|pre[cç]o|valor d[aeo]|quanto (é|sai)/i, intent: 'FAQ_ADMIN' },
  {
    when: /formas? de pagamento|aceita(m)? (pix|cart[aã]o|dinheiro)/i,
    intent: 'FAQ_ADMIN',
  },

  {
    when: /\b(quais|meus|minhas)\b[^.!?]{0,30}\b(atendimentos?|agendamentos?|consultas?|marcad[oa]s?)\b|\btenho\b[^.!?]{0,20}\b(consulta|agendamento|atendimento)s?\b/i,
    intent: 'LIST_APPOINTMENTS',
  },

  { when: /remarcar|reagendar|mudar (o )?hor[aá]rio|trocar (o )?hor[aá]rio/i, intent: 'RESCHEDULE_REQUEST' },
  { when: /cancelar|desmarcar/i, intent: 'CANCEL_REQUEST' },

  // Scheduling. Accept the natural ways people ask for a slot.
  {
    when: /agendar|marcar|encaixar|tem (vaga|hor[aá]rio)|disponibilidade|queria (uma )?(consulta|limpeza|avalia[cç][aã]o|hor[aá]rio)|ver (um )?hor[aá]rio|consegue (um )?hor[aá]rio/i,
    intent: 'SCHEDULE_REQUEST',
  },

  { when: /\bdor\b|inflamad|sangr|sensibilidade|inchaco|incha[cç]o/i, intent: 'CLINICAL_QUESTION' },
  { when: /falar com (o )?dentista|humano|atendente|recepcionista/i, intent: 'HUMAN_REQUEST' },

  { when: /^(oi|ol[aá]|bom dia|boa tarde|boa noite|tudo bem|tudo bom|como vai|e a[ií])/i, intent: 'GREETING' },
  {
    when: /obrigad|valeu|agradec|at[eé] (mais|logo)|tchau|boa noite$|bom fim de semana/i,
    intent: 'SMALL_TALK',
  },
];
