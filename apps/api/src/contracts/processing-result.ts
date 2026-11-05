import { z } from 'zod';

export const PROCESSING_STATUSES = [
  'COMPLETED',
  'PENDING',
  'FAILED',
  'UNKNOWN',
  'REQUIRES_HUMAN',
  'REQUIRES_CLARIFICATION',
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const ProcessingResultSchema = z
  .object({
    success: z.boolean(),
    status: z.enum(PROCESSING_STATUSES),
    data: z.unknown().nullable(),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        retryable: z.boolean(),
      })
      .nullable(),
    correlationId: z.string().min(1),
  })
  .superRefine((result, ctx) => {
    if (result.status === 'FAILED' && result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['success'],
        message: 'success must be false when status is FAILED',
      });
    }
  });

export interface ProcessingError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ProcessingResult<T = unknown> {
  success: boolean;
  status: ProcessingStatus;
  data: T | null;
  error: ProcessingError | null;
  correlationId: string;
}
