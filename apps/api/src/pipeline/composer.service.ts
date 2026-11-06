import { pick } from '../common/message-style';
import { pickMessage } from '../messages/templates';
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
        // Locked template: the safety protocol is never editable.
        return pickMessage('emergency_protocol');
      case 'HOLDING_ESCALATED':
        return pickMessage('holding_escalated', { sla: ctx.slaMinutes });
      case 'UNSUPPORTED_MEDIA':
        return pick([
          'Por enquanto consigo ler apenas mensagens de texto. Pode me escrever o que você precisa?',
          'Ainda não consigo abrir esse tipo de arquivo. Me conta por texto o que você precisa?',
        ]);
      case 'GREETING':
        return pickMessage('greeting');
      case 'CLARIFY':
        return pickMessage('clarify');
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
