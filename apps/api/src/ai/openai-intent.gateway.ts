import { IntentResponse, IntentResponseSchema } from '../contracts/intent';
import { AiGateway, IntentRequest } from './ai-gateway';
import { buildIntentPrompt } from './intent-prompt';

export { buildIntentPrompt } from './intent-prompt';

interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class OpenAiIntentGateway implements AiGateway {
  readonly provider = 'openai';
  readonly model = 'gpt-4o-mini';
  readonly promptVersion = 'intent-v1';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async classifyIntent(request: IntentRequest): Promise<IntentResponse> {
    const { system, user } = buildIntentPrompt(request);

    const response = await this.fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status}`);
    }

    const payload = (await response.json()) as OpenAiResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned no content');
    }

    return IntentResponseSchema.parse(JSON.parse(content));
  }
}
