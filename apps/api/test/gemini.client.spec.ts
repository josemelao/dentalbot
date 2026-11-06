import { GeminiClient } from '../src/ai/gemini.client';

const response = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
    async json() {
      return body;
    },
  }) as Response;

describe('GeminiClient', () => {
  it('sends the system instruction and parses the text', async () => {
    let captured: { url?: string; body?: unknown } = {};
    const client = new GeminiClient(
      'key-123',
      'gemini-2.5-flash',
      (async (url: string, init: RequestInit) => {
        captured = { url, body: JSON.parse(String(init.body)) };
        return response({
          candidates: [{ content: { parts: [{ text: '{"route":"SCHEDULE"}' }] } }],
        });
      }) as typeof fetch,
    );

    const text = await client.complete({ system: 'sys', user: 'usr' });

    expect(text).toBe('{"route":"SCHEDULE"}');
    expect(captured.url).toContain('models/gemini-2.5-flash:generateContent');
    expect(captured.url).toContain('key=key-123');
    expect(captured.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'usr' }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    });
  });

  it('throws when the API fails', async () => {
    const client = new GeminiClient(
      'key',
      'gemini-2.5-flash',
      (async () => response({}, false)) as typeof fetch,
    );

    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(/Gemini request failed/);
  });

  it('throws when there is no candidate content', async () => {
    const client = new GeminiClient(
      'key',
      'gemini-2.5-flash',
      (async () => response({ candidates: [] })) as typeof fetch,
    );

    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(/no content/);
  });
});
