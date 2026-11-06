import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ClinicUsersRepository } from '../db/repositories/clinic-users.repository';

export interface PanelSession {
  userId: string;
  tenantId: string;
  name: string;
}

export interface PanelAuthDependencies {
  users: ClinicUsersRepository;
  secret: string | null;
  now: () => Date;
  ttlMs?: number;
}

const COOKIE = 'painel_session';
const DEFAULT_TTL_MS = 8 * 60 * 60_000;

export class PanelAuthService {
  constructor(private readonly deps: PanelAuthDependencies) {}

  get enabled(): boolean {
    return Boolean(this.deps.secret);
  }

  hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
  }

  verifyPassword(password: string, stored: string): boolean {
    const [scheme, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;

    const computed = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    if (computed.length !== expected.length) return false;
    return timingSafeEqual(computed, expected);
  }

  /** Returns the cookie value, or null when the credentials are wrong. */
  async login(email: string, password: string): Promise<string | null> {
    if (!this.deps.secret) return null;

    const user = await this.deps.users.findByEmail(email);
    if (!user || user.status !== 'active' || !user.passwordHash) return null;
    if (!this.verifyPassword(password, user.passwordHash)) return null;

    return this.sign({ userId: user.id, tenantId: user.tenantId, name: user.name });
  }

  verify(cookieHeader: string | undefined): PanelSession | null {
    if (!cookieHeader || !this.deps.secret) return null;

    const raw = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!raw) return null;

    const [payload, signature] = raw.split('.');
    if (!payload || !signature) return null;

    const expected = this.signature(payload);
    const given = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;

    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as PanelSession & {
        exp: number;
      };
      if (typeof parsed.exp !== 'number' || parsed.exp < this.deps.now().getTime()) return null;
      return { userId: parsed.userId, tenantId: parsed.tenantId, name: parsed.name };
    } catch {
      return null;
    }
  }

  cookieName(): string {
    return COOKIE;
  }

  cookieMaxAgeSeconds(): number {
    return Math.floor((this.deps.ttlMs ?? DEFAULT_TTL_MS) / 1000);
  }

  private sign(session: PanelSession): string {
    const ttl = this.deps.ttlMs ?? DEFAULT_TTL_MS;
    const payload = Buffer.from(
      JSON.stringify({ ...session, exp: this.deps.now().getTime() + ttl }),
    ).toString('base64url');
    return `${payload}.${this.signature(payload)}`;
  }

  private signature(payload: string): string {
    return createHmac('sha256', this.deps.secret ?? '').update(payload).digest('base64url');
  }
}
