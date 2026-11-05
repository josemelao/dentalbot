import { Queryable } from '../pool';

export interface RecordAiInvocationInput {
  tenantId: string;
  conversationId?: string | null;
  messageId?: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  confidence?: number | null;
  decision?: Record<string, unknown>;
}

export class AiInvocationsRepository {
  constructor(private readonly db: Queryable) {}

  async record(input: RecordAiInvocationInput): Promise<void> {
    await this.db.query(
      `insert into ai_invocations
         (tenant_id, conversation_id, message_id, provider, model, prompt_version,
          input_tokens, output_tokens, cost_usd, latency_ms, confidence, decision)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        input.tenantId,
        input.conversationId ?? null,
        input.messageId ?? null,
        input.provider,
        input.model,
        input.promptVersion,
        input.inputTokens ?? 0,
        input.outputTokens ?? 0,
        input.costUsd ?? 0,
        input.latencyMs ?? 0,
        input.confidence ?? null,
        input.decision ?? {},
      ],
    );
  }
}
