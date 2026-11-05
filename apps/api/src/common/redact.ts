const SENSITIVE_KEY =
  /^(phone|phone_e164|phoneE164|content|authorization|token|secret|apiKey|api_key)$/i;

export function redactPhone(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  return '*'.repeat(value.length - 4) + value.slice(-4);
}

export function redactMessage(value: string): string {
  return `[redacted:${value.length}]`;
}

export function redactContext(
  context?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!context) return undefined;

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!SENSITIVE_KEY.test(key)) {
      redacted[key] = value;
      continue;
    }

    if (key.toLowerCase().includes('content')) {
      redacted[key] = '[redacted]';
    } else if (typeof value === 'string') {
      redacted[key] = redactPhone(value);
    } else {
      redacted[key] = '[redacted]';
    }
  }
  return redacted;
}
