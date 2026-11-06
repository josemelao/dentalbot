import { LlmClient, LlmRequest } from './llm-client';

interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class OpenAiClient implements LlmClient {
  readonly provider = 'openai';

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'gpt-4o-mini',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(request: LlmRequest): Promise<string> {
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
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status}`);
    }

    const payload = (await response.json()) as OpenAiResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned no content');
    return content;
  }
}
