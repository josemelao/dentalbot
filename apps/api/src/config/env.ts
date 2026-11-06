import { z } from 'zod';

const DEFAULT_TEST_DATABASE_URL =
  'postgres://postgres:postgres@localhost:5432/dental_assistant_test';

/** An empty or whitespace-only env var is the same as not setting it at all. */
const optionalString = (schema: z.ZodString) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length === 0 ? undefined : value,
    schema.optional(),
  );

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    TEST_DATABASE_URL: z.string().min(1).default(DEFAULT_TEST_DATABASE_URL),
    TELEGRAM_BOT_TOKEN: optionalString(z.string().min(1)),
    TELEGRAM_WEBHOOK_SECRET: optionalString(z.string().min(1)),
    TELEGRAM_API_BASE_URL: z.string().url().default('https://api.telegram.org'),
    AI_PROVIDER: z.enum(['fake', 'openai', 'gemini']).default('fake'),
    CHANNEL_TRANSPORT: z.enum(['telegram', 'fake']).default('telegram'),
    OPENAI_API_KEY: optionalString(z.string().min(1)),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
    GEMINI_API_KEY: optionalString(z.string().min(1)),
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
    ROUTER_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
    MESSAGE_EMOJI: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    TYPING_MIN_MS: z.coerce.number().int().min(0).default(400),
    TYPING_PER_CHAR_MS: z.coerce.number().int().min(0).default(25),
    TYPING_MAX_MS: z.coerce.number().int().min(0).default(2500),
    LOG_LEVEL: z.string().default('info'),
    SLA_MINUTES: z.coerce.number().int().positive().default(15),
    WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
    REMINDER_MIN_LEAD_HOURS: z.coerce.number().int().positive().default(20),
    REMINDER_MAX_LEAD_HOURS: z.coerce.number().int().positive().default(28),
  })
  .superRefine((env, ctx) => {
    if (env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEGRAM_WEBHOOK_SECRET'],
        message: 'TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_BOT_TOKEN is set',
      });
    }
    if (env.AI_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when AI_PROVIDER=openai',
      });
    }
    if (env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when AI_PROVIDER=gemini',
      });
    }
  });

export interface AppEnv {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  testDatabaseUrl: string;
  telegramBotToken: string | null;
  telegramWebhookSecret: string;
  telegramApiBaseUrl: string;
  aiProvider: 'fake' | 'openai' | 'gemini';
  channelTransport: 'telegram' | 'fake';
  openaiApiKey: string | null;
  openaiModel: string;
  geminiApiKey: string | null;
  geminiModel: string;
  routerConfidenceThreshold: number;
  messageEmoji: boolean;
  typingMinMs: number;
  typingPerCharMs: number;
  typingMaxMs: number;
  logLevel: string;
  slaMinutes: number;
  workerIntervalMs: number;
  reminderMinLeadHours: number;
  reminderMaxLeadHours: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }

  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    testDatabaseUrl: env.TEST_DATABASE_URL,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? null,
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? '',
    telegramApiBaseUrl: env.TELEGRAM_API_BASE_URL,
    aiProvider: env.AI_PROVIDER,
    channelTransport: env.CHANNEL_TRANSPORT,
    openaiApiKey: env.OPENAI_API_KEY ?? null,
    openaiModel: env.OPENAI_MODEL,
    geminiApiKey: env.GEMINI_API_KEY ?? null,
    geminiModel: env.GEMINI_MODEL,
    routerConfidenceThreshold: env.ROUTER_CONFIDENCE_THRESHOLD,
    messageEmoji: env.MESSAGE_EMOJI,
    typingMinMs: env.TYPING_MIN_MS,
    typingPerCharMs: env.TYPING_PER_CHAR_MS,
    typingMaxMs: env.TYPING_MAX_MS,
    logLevel: env.LOG_LEVEL,
    slaMinutes: env.SLA_MINUTES,
    workerIntervalMs: env.WORKER_INTERVAL_MS,
    reminderMinLeadHours: env.REMINDER_MIN_LEAD_HOURS,
    reminderMaxLeadHours: env.REMINDER_MAX_LEAD_HOURS,
  };
}
