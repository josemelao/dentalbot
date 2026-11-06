export interface MessageStyle {
  emoji: boolean;
}

let style: MessageStyle = { emoji: true };
let random: () => number = Math.random;

/** Tests pin this to 0 so the first variant is always used. */
export function setMessageRandom(fn: () => number): void {
  random = fn;
}

export function configureMessageStyle(options: Partial<MessageStyle>): void {
  style = { ...style, ...options };
}

export function messageStyle(): MessageStyle {
  return style;
}

/**
 * Picks one wording out of a variant pool.
 *
 * Variation is per message, not per conversation: a person does not repeat the
 * same sentence every time either, and each turn is a fresh exchange.
 */
export function pick<T>(variants: readonly T[]): T {
  if (variants.length === 0) throw new Error('pick() needs at least one variant');
  if (variants.length === 1) return variants[0];
  const index = Math.floor(random() * variants.length) % variants.length;
  return variants[index];
}

/** Appends the emoji only when the clinic wants them. */
export function withEmoji(text: string, emoji: string): string {
  return style.emoji ? `${text} ${emoji}` : text;
}
