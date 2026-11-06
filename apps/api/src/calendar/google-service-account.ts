import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface ServiceAccountTokenOptions {
  keyPath: string;
  scope?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/calendar';

/**
 * Exchanges the service-account key for an access token, caching it until it
 * expires. No SDK: RS256 JWT + token endpoint, exactly what the API expects.
 */
export class GoogleServiceAccountToken {
  private cached: { token: string; expiresAt: number } | null = null;
  private readonly key: ServiceAccountKey;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: ServiceAccountTokenOptions) {
    this.key = JSON.parse(readFileSync(options.keyPath, 'utf8')) as ServiceAccountKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  get clientEmail(): string {
    return this.key.client_email;
  }

  async getAccessToken(): Promise<string> {
    const seconds = Math.floor(this.now() / 1000);
    if (this.cached && this.cached.expiresAt > seconds + 60) {
      return this.cached.token;
    }

    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: this.key.client_email,
      scope: this.options.scope ?? DEFAULT_SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: seconds,
      exp: seconds + 3600,
    };

    const encode = (value: object): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode(header)}.${encode(claim)}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(this.key.private_key, 'base64url');

    const response = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google token exchange failed: ${response.status}`);
    }

    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Google token exchange returned no token');

    this.cached = {
      token: body.access_token,
      expiresAt: seconds + (body.expires_in ?? 3600),
    };
    return body.access_token;
  }
}
