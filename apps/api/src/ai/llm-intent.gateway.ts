import { IntentResponse, IntentResponseSchema } from '../contracts/intent';
import { AiGateway, IntentRequest } from './ai-gateway';
import { buildIntentPrompt } from './intent-prompt';
import { LlmClient } from './llm-client';

/** Same prompt and validation for every provider; only the client changes. */
export class LlmIntentGateway implements AiGateway {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion = 'intent-v1';

  constructor(private readonly client: LlmClient) {
    this.provider = client.provider;
    this.model = client.model;
  }

  async classifyIntent(request: IntentRequest): Promise<IntentResponse> {
    const { system, user } = buildIntentPrompt(request);
    const content = await this.client.complete({ system, user });
    return IntentResponseSchema.parse(JSON.parse(content));
  }
}
