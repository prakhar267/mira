import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export interface AuthIdentityRecord {
  email: string;
  userId: string;
  passwordHash: string;
  emailVerified: boolean;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: number;
  revokedAt?: number;
}

export interface AuthChallengeRecord {
  tokenHash: string;
  email: string;
  kind: "password-reset" | "email-verification";
  expiresAt: number;
}

export interface AuthStore {
  createIdentity(identity: AuthIdentityRecord): Promise<void>;
  deleteIdentity(email: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  findIdentity(email: string): Promise<AuthIdentityRecord | null>;
  updateIdentity(identity: AuthIdentityRecord): Promise<void>;
  saveSession(session: AuthSessionRecord): Promise<void>;
  findSessionById(sessionId: string): Promise<AuthSessionRecord | null>;
  findSessionByRefreshHash(refreshTokenHash: string): Promise<AuthSessionRecord | null>;
  revokeSession(sessionId: string): Promise<void>;
  revokeSessionsForUser(userId: string): Promise<void>;
  saveChallenge(challenge: AuthChallengeRecord): Promise<void>;
  consumeChallenge(tokenHash: string, kind: AuthChallengeRecord["kind"]): Promise<AuthChallengeRecord | null>;
}

export class InMemoryAuthStore implements AuthStore {
  private readonly identities = new Map<string, AuthIdentityRecord>();
  private readonly sessions = new Map<string, AuthSessionRecord>();
  private readonly challenges = new Map<string, AuthChallengeRecord>();

  async createIdentity(identity: AuthIdentityRecord) {
    const email = identity.email.toLowerCase();
    if (this.identities.has(email)) throw new Error("Identity already exists");
    this.identities.set(email, { ...identity, email });
  }
  async deleteIdentity(email: string) { this.identities.delete(email.toLowerCase()); }
  async deleteUser(userId: string) {
    for (const [email, identity] of this.identities) if (identity.userId === userId) this.identities.delete(email);
    for (const [sessionId, session] of this.sessions) if (session.userId === userId) this.sessions.delete(sessionId);
  }
  async findIdentity(email: string) { return this.identities.get(email.toLowerCase()) ?? null; }
  async updateIdentity(identity: AuthIdentityRecord) { this.identities.set(identity.email.toLowerCase(), { ...identity, email: identity.email.toLowerCase() }); }
  async saveSession(session: AuthSessionRecord) { this.sessions.set(session.id, { ...session }); }
  async findSessionById(sessionId: string) { return this.sessions.get(sessionId) ?? null; }
  async findSessionByRefreshHash(refreshTokenHash: string) {
    return [...this.sessions.values()].find((session) => session.refreshTokenHash === refreshTokenHash) ?? null;
  }
  async revokeSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) this.sessions.set(sessionId, { ...session, revokedAt: Date.now() });
  }
  async revokeSessionsForUser(userId: string) {
    for (const [sessionId, session] of this.sessions) {
      if (session.userId === userId && !session.revokedAt) this.sessions.set(sessionId, { ...session, revokedAt: Date.now() });
    }
  }
  async saveChallenge(challenge: AuthChallengeRecord) { this.challenges.set(challenge.tokenHash, { ...challenge }); }
  async consumeChallenge(tokenHash: string, kind: AuthChallengeRecord["kind"]) {
    const challenge = this.challenges.get(tokenHash);
    if (!challenge || challenge.kind !== kind || challenge.expiresAt <= Date.now()) return null;
    this.challenges.delete(tokenHash);
    return challenge;
  }
}

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function encodeJson(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expectedBuffer = Buffer.from(expected, "base64url");
  return expectedBuffer.length === actual.length && timingSafeEqual(expectedBuffer, actual);
}

export class AuthService {
  constructor(private readonly store: AuthStore, private readonly secret: string) {}

  async register(email: string, password: string, userId: string) {
    const identity: AuthIdentityRecord = { email: email.toLowerCase(), userId, passwordHash: await hashPassword(password), emailVerified: false };
    await this.store.createIdentity(identity);
    const verificationToken = await this.createChallenge(identity.email, "email-verification", 24 * 60 * 60_000);
    return { identity, verificationToken, tokens: await this.issueTokens(userId) };
  }

  async rollbackRegistration(email: string) { await this.store.deleteIdentity(email); }
  async deleteUser(userId: string) { await this.store.deleteUser(userId); }

  async login(email: string, password: string) {
    const identity = await this.store.findIdentity(email);
    if (!identity || !await verifyPassword(password, identity.passwordHash)) return null;
    return { identity, tokens: await this.issueTokens(identity.userId) };
  }

  async requestPasswordReset(email: string) {
    const identity = await this.store.findIdentity(email);
    if (!identity) return null;
    return this.createChallenge(identity.email, "password-reset", 60 * 60_000);
  }

  async issueTokens(userId: string) {
    const sessionId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const payload = encodeJson({ sub: userId, sid: sessionId, iat: now, exp: now + 15 * 60 });
    const signature = createHmac("sha256", this.secret).update(payload).digest("base64url");
    const accessToken = `${payload}.${signature}`;
    const refreshToken = randomBytes(48).toString("base64url");
    await this.store.saveSession({ id: sessionId, userId, refreshTokenHash: sha256(refreshToken), expiresAt: Date.now() + 30 * 86_400_000 });
    return { accessToken, refreshToken, accessExpiresAt: new Date((now + 15 * 60) * 1000).toISOString() };
  }

  async verifyAccessToken(token: string): Promise<{ userId: string; sessionId: string } | null> {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = createHmac("sha256", this.secret).update(payload).digest("base64url");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; sid?: string; exp?: number };
      if (!decoded.sub || !decoded.sid || !decoded.exp || decoded.exp <= Math.floor(Date.now() / 1000)) return null;
      const session = await this.store.findSessionById(decoded.sid);
      if (!session || session.userId !== decoded.sub || session.revokedAt || session.expiresAt <= Date.now()) return null;
      return { userId: decoded.sub, sessionId: decoded.sid };
    } catch {
      return null;
    }
  }

  async rotate(refreshToken: string) {
    const session = await this.store.findSessionByRefreshHash(sha256(refreshToken));
    if (!session || session.revokedAt || session.expiresAt <= Date.now()) return null;
    await this.store.revokeSession(session.id);
    return this.issueTokens(session.userId);
  }

  async logout(accessToken: string) {
    const verified = await this.verifyAccessToken(accessToken);
    if (verified) await this.store.revokeSession(verified.sessionId);
  }

  async createChallenge(email: string, kind: AuthChallengeRecord["kind"], ttlMs: number) {
    const token = randomBytes(40).toString("base64url");
    await this.store.saveChallenge({ tokenHash: sha256(token), email: email.toLowerCase(), kind, expiresAt: Date.now() + ttlMs });
    return token;
  }

  async consumeChallenge(token: string, kind: AuthChallengeRecord["kind"]) {
    return this.store.consumeChallenge(sha256(token), kind);
  }

  async resetPassword(token: string, password: string) {
    const challenge = await this.consumeChallenge(token, "password-reset");
    if (!challenge) return false;
    const identity = await this.store.findIdentity(challenge.email);
    if (!identity) return false;
    await this.store.updateIdentity({ ...identity, passwordHash: await hashPassword(password) });
    await this.store.revokeSessionsForUser(identity.userId);
    return true;
  }

  async verifyEmail(token: string) {
    const challenge = await this.consumeChallenge(token, "email-verification");
    if (!challenge) return false;
    const identity = await this.store.findIdentity(challenge.email);
    if (!identity) return false;
    await this.store.updateIdentity({ ...identity, emailVerified: true });
    return true;
  }
}
