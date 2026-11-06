import { z } from 'zod';

export const INTENTS = [
  'GREETING',
  'FAQ_ADMIN',
  'SCHEDULE_REQUEST',
  'RESCHEDULE_REQUEST',
  'CANCEL_REQUEST',
  'LIST_APPOINTMENTS',
  'CONFIRM_APPOINTMENT',
  'CLINICAL_QUESTION',
  'EMERGENCY',
  'HUMAN_REQUEST',
  'SMALL_TALK',
  'UNKNOWN',
] as const;

export type Intent = (typeof INTENTS)[number];

export const IntentSchema = z.enum(INTENTS);

export const IntentResponseSchema = z.object({
  intent: IntentSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().nullable(),
});

export type IntentResponse = z.infer<typeof IntentResponseSchema>;
