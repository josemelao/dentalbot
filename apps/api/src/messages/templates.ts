import { pick } from '../common/message-style';

export interface TemplateDefinition {
  key: string;
  label: string;
  /** Locked keys are shown read-only in the panel and ignored on write. */
  locked: boolean;
  defaults: string[];
}

export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    key: 'greeting',
    label: 'Saudação',
    locked: false,
    defaults: [
      'Olá! Sou a secretária virtual da clínica. Posso ajudar com horários, endereço, agendamento e informações administrativas. Como posso ajudar?',
      'Oi! Sou a secretária virtual da clínica. Me diz como posso ajudar — horários, agendamento ou informações administrativas.',
    ],
  },
  {
    key: 'clarify',
    label: 'Pedido de esclarecimento',
    locked: false,
    defaults: [
      'Para te ajudar, pode me contar um pouco mais sobre o que você precisa?',
      'Posso ajudar com horário, agendamento, valores ou falar com a equipe. O que você precisa?',
      'Me dá um detalhe a mais? Assim consigo te ajudar melhor.',
    ],
  },
  {
    key: 'schedule.ask_service',
    label: 'Agendamento — perguntar serviço',
    locked: false,
    defaults: [
      'Qual serviço você precisa? Tenho: {{services}}.',
      'Claro! Me conta o que você precisa: {{services}}.',
      'O que você está pensando? Posso ajudar com {{services}}.',
    ],
  },
  {
    key: 'schedule.offer_slots',
    label: 'Agendamento — oferecer horários',
    locked: false,
    defaults: [
      'Tenho estes horários para {{service}}:\n{{slots}}\nResponda com o número.',
      'Achei estas opções para {{service}}:\n{{slots}}\n\nMe diz o número ou o dia que prefere.',
      'Consegui estes horários para {{service}} 👇\n{{slots}}\n\nQual fica melhor?',
    ],
  },
  {
    key: 'schedule.ask_number',
    label: 'Agendamento — pedir o número',
    locked: false,
    defaults: [
      'Responda com o número de uma das opções:\n{{slots}}',
      'Não peguei qual você quis. Me diz o número:\n{{slots}}',
    ],
  },
  {
    key: 'schedule.confirm',
    label: 'Agendamento — confirmar',
    locked: false,
    defaults: [
      'Confirma {{service}} em {{when}}? Responda SIM ou NÃO.',
      'Fechado: {{service}} em {{when}}. Posso confirmar? (SIM ou NÃO)',
    ],
  },
  {
    key: 'schedule.booked',
    label: 'Agendamento — confirmado',
    locked: false,
    defaults: [
      'Agendado! {{service}} em {{when}}. Até lá.',
      'Prontinho! {{service}} em {{when}}. Te espero lá.',
    ],
  },
  {
    key: 'holding_escalated',
    label: 'Mensagem de espera (SLA) — travada',
    locked: true,
    defaults: [
      'Recebi sua mensagem. Vou confirmar essa informação com a equipe e te respondo em até {{sla}} minutos. Se for urgente, procure atendimento imediatamente.',
    ],
  },
  {
    key: 'emergency_protocol',
    label: 'Protocolo de emergência — travada',
    locked: true,
    defaults: [
      'Pelo que você descreveu, isso pode ser uma urgência. Procure atendimento imediatamente. Se houver dificuldade para respirar ou engolir, inchaço importante ou sangramento que não para, ligue para o SAMU (192) ou vá ao pronto-socorro mais próximo.',
    ],
  },
];

const byKey = new Map(TEMPLATE_DEFINITIONS.map((definition) => [definition.key, definition]));

const overrides = new Map<string, string[]>();

export function defaultVariants(key: string): string[] {
  return byKey.get(key)?.defaults ?? [];
}

export function isLocked(key: string): boolean {
  return byKey.get(key)?.locked ?? true;
}

/** Replaces the in-memory copy after boot or after a panel edit. */
export function setTemplateOverrides(entries: Array<{ key: string; variants: string[] }>): void {
  overrides.clear();
  for (const entry of entries) {
    if (entry.variants.length > 0) overrides.set(entry.key, entry.variants);
  }
}

export function setTemplateOverride(key: string, variants: string[]): void {
  if (variants.length > 0) overrides.set(key, variants);
  else overrides.delete(key);
}

export function templateOverride(key: string): string[] | null {
  return overrides.get(key) ?? null;
}

export function effectiveVariants(key: string): string[] {
  return overrides.get(key) ?? defaultVariants(key);
}

const render = (template: string, vars: Record<string, string | number>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));

/** Picks one variant (override or default) and fills the placeholders. */
export function pickMessage(
  key: string,
  vars: Record<string, string | number> = {},
): string {
  const variants = effectiveVariants(key);
  if (variants.length === 0) {
    throw new Error(`No template variants for key ${key}`);
  }
  return render(pick(variants), vars);
}
