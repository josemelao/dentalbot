import { z } from 'zod';

export const SAFETY_TIERS = ['EMERGENCY', 'CLINICAL', 'ADMINISTRATIVE'] as const;

export type SafetyTier = (typeof SAFETY_TIERS)[number];

export const TriageResultSchema = z.object({
  tier: z.enum(SAFETY_TIERS),
  matchedRule: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;
