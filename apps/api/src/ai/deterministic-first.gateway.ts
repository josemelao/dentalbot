import { IntentResponse } from '../contracts/intent';
import { AiGateway, IntentRequest } from './ai-gateway';
import { DEFAULT_AI_RULES } from './default-rules';
import { FakeAiRule } from './fake-ai.gateway';

/**
 * Cost guard: answer the obvious intents with rules and only pay for a model
 * call on the residue. Wrapping the gateway (instead of changing IntentService)
 * keeps the AI as a pure classifier and leaves the fake provider untouched.
 */
export class DeterministicFirstGateway implements AiGateway {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;

  constructor(
    private readonly inner: AiGateway,
    private readonly rules: FakeAiRule[] = DEFAULT_AI_RULES,
  ) {
    this.provider = inner.provider;
    this.model = inner.model;
    this.promptVersion = inner.promptVersion;
  }

  async classifyIntent(request: IntentRequest): Promise<IntentResponse> {
    const rule = this.rules.find((candidate) => candidate.when.test(request.text));
    if (rule) {
      return {
        intent: rule.intent,
        confidence: rule.confidence ?? 1,
        rationale: 'deterministic',
      };
    }

    return this.inner.classifyIntent(request);
  }
}
