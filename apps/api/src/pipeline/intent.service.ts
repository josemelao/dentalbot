import { AiGateway, IntentRequest } from '../ai/ai-gateway';
import { Intent, IntentResponseSchema } from '../contracts/intent';
import { Queryable } from '../db/pool';
import { AiInvocationsRepository } from '../db/repositories/ai-invocations.repository';

export interface ClassifiedIntent {
  intent: Intent;
  confidence: number;
  source: 'ai' | 'fallback';
}

export class IntentService {
  private readonly invocations: AiInvocationsRepository;

  constructor(
    private readonly ai: AiGateway,
    db: Queryable,
  ) {
    this.invocations = new AiInvocationsRepository(db);
  }

  async classify(input: IntentRequest): Promise<ClassifiedIntent> {
    const started = performance.now();
    let intent: Intent = 'UNKNOWN';
    let confidence = 0;
    let source: 'ai' | 'fallback' = 'fallback';

    try {
      const response = await this.ai.classifyIntent(input);
      const parsed = IntentResponseSchema.safeParse(response);
      if (parsed.success) {
        intent = parsed.data.intent;
        confidence = parsed.data.confidence;
        source = 'ai';
      }
    } catch {
      // Safe fallback: unknown intent is escalated, never guessed.
    }

    const latencyMs = Math.round(performance.now() - started);

    await this.invocations.record({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      provider: this.ai.provider,
      model: this.ai.model,
      promptVersion: this.ai.promptVersion,
      latencyMs,
      confidence,
      decision: { intent, source },
    });

    return { intent, confidence, source };
  }
}
