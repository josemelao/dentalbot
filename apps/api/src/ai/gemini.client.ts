import { LlmClient, LlmRequest } from './llm-client';

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
}

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiClient implements LlmClient {
  readonly provider = 'gemini';

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'gemini-2.5-flash',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(request: LlmRequest): Promise<string> {
    const response = await this.fetchImpl(
      `${BASE_URL}/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.user }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Gemini request failed: ${response.status}`);
    }

    const payload = (await response.json()) as GeminiResponse;
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!text) throw new Error('Gemini returned no content');
    return text;
  }
}
