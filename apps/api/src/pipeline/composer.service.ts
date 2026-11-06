import { pick, withEmoji } from '../common/message-style';
import { Decision } from './decision';

export interface ComposerContext {
  slaMinutes: number;
}

export class ResponseComposer {
  compose(decision: Decision, ctx: ComposerContext): string | null {
    switch (decision.kind) {
      case 'ANSWER_FAQ':
        return decision.entry.answer;
      case 'EMERGENCY_PROTOCOL':
        // Never varies: this is the approved safety protocol.
        return 'Pelo que você descreveu, isso pode ser uma urgência. Procure atendimento imediatamente. Se houver dificuldade para respirar ou engolir, inchaço importante ou sangramento que não para, ligue para o SAMU (192) ou vá ao pronto-socorro mais próximo.';
      case 'HOLDING_ESCALATED':
        return pick([
          `Recebi sua mensagem. Vou confirmar essa informação com a equipe e te respondo em até ${ctx.slaMinutes} minutos. Se for urgente, procure atendimento imediatamente.`,
          `Já passei sua mensagem para a equipe. Te respondo em até ${ctx.slaMinutes} minutos. Se for urgente, procure atendimento imediatamente.`,
        ]);
      case 'UNSUPPORTED_MEDIA':
        return pick([
          'Por enquanto consigo ler apenas mensagens de texto. Pode me escrever o que você precisa?',
          'Ainda não consigo abrir esse tipo de arquivo. Me conta por texto o que você precisa?',
        ]);
      case 'GREETING':
        return pick([
          'Olá! Sou a secretária virtual da clínica. Posso ajudar com horários, endereço, agendamento e informações administrativas. Como posso ajudar?',
          withEmoji(
            'Oi! Sou a secretária virtual da clínica. Posso ajudar com horários, endereço, agendamento e informações administrativas. Como posso ajudar?',
            '😊',
          ),
          'Oi, tudo bem? Sou a secretária virtual da clínica. Me diz como posso ajudar — horários, agendamento ou informações administrativas.',
        ]);
      case 'CLARIFY':
        return pick([
          'Para te ajudar, pode me contar um pouco mais sobre o que você precisa?',
          'Posso ajudar com horário, agendamento, valores ou falar com a equipe. O que você precisa?',
          'Me dá um detalhe a mais? Assim consigo te ajudar melhor.',
        ]);
      case 'SMALL_TALK':
        return pick([
          'Tudo ótimo por aqui! Como posso ajudar?',
          'Por nada! Se precisar de mais alguma coisa, é só chamar.',
          'Até mais! Qualquer coisa, estou por aqui.',
        ]);
      case 'HUMAN_ACTIVE_SILENT':
        return null;
      case 'FLOW_REPLY':
        return decision.result.reply;
    }
  }
}
