import { Intent, IntentResponse } from '../contracts/intent';
import { AiGateway, IntentRequest } from './ai-gateway';

export interface FakeAiRule {
  when: RegExp;
  intent: Intent;
  confidence?: number;
}

export class FakeAiGateway implements AiGateway {
  readonly provider = 'fake';
  readonly model = 'fake-intent';
  readonly promptVersion = 'intent-v1';

  readonly sent: IntentRequest[] = [];
  lastRequest: IntentRequest | null = null;
  failNext: Error | null = null;
  nextInvalid = false;

  private rules: FakeAiRule[];
  private readonly fallback: Intent;

  constructor(rules: FakeAiRule[] = [], fallback: Intent = 'UNKNOWN') {
    this.rules = rules;
    this.fallback = fallback;
  }

  setRules(rules: FakeAiRule[]): this {
    this.rules = rules;
    return this;
  }

  async classifyIntent(request: IntentRequest): Promise<IntentResponse> {
    this.lastRequest = request;
    this.sent.push(request);

    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }

    if (this.nextInvalid) {
      this.nextInvalid = false;
      return { intent: 'NOT_AN_INTENT' as Intent, confidence: 1, rationale: null };
    }

    const rule = this.rules.find((candidate) => candidate.when.test(request.text));
    return {
      intent: rule?.intent ?? this.fallback,
      confidence: rule?.confidence ?? 0.5,
      rationale: null,
    };
  }
}
