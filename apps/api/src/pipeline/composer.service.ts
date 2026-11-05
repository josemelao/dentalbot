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
        return 'Pelo que você descreveu, isso pode ser uma urgência. Procure atendimento imediatamente. Se houver dificuldade para respirar ou engolir, inchaço importante ou sangramento que não para, ligue para o SAMU (192) ou vá ao pronto-socorro mais próximo. Já avisei a equipe da clínica.';
      case 'HOLDING_ESCALATED':
        return `Recebi sua mensagem. Vou confirmar essa informação com a equipe e te respondo em até ${ctx.slaMinutes} minutos. Se for urgente, procure atendimento imediatamente.`;
      case 'UNSUPPORTED_MEDIA':
        return 'Por enquanto consigo ler apenas mensagens de texto. Pode me escrever o que você precisa?';
      case 'GREETING':
        return 'Olá! Sou a secretária virtual da clínica. Posso ajudar com horários, endereço, agendamento e informações administrativas. Como posso ajudar?';
      case 'CLARIFY':
        return 'Para te ajudar, pode me contar um pouco mais sobre o que você precisa?';
      case 'HUMAN_ACTIVE_SILENT':
        return null;
    }
  }
}
