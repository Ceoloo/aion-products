/**
 * Session helpers for the Console BFF (Hono backend service).
 *
 * The browser never sees a Runtime bearer token or the login secret — it
 * only ever holds an httpOnly session cookie. This file signs/verifies that
 * cookie with HMAC-SHA256 (no JWT library needed for a single-purpose,
 * single-claim token) and centralizes the few required env vars.
 *
 * Cookie payload (v2): `v2.<expiresAtUnix>.<sid>.<epoch>` + HMAC.
 *   - expiresAtUnix — server-enforced expiry (not only browser Max-Age)
 *   - sid           — random id (supports per-session revocation)
 *   - epoch         — SESSION_EPOCH claim; bumping the env revokes all cookies
 *
 * v1 cookies (`v1.<expiresAt>.<sig>`) remain accepted until they expire so
 * in-flight operator sessions survive a rolling deploy.
 *
 * Required env (Vercel project settings — server-only, never VITE_*):
 *   CONSOLE_LOGIN_SECRET     shared secret the operator enters to sign in
 *   SESSION_SIGNING_SECRET   HMAC key for signing session cookies
 *   AION_GATEWAY_TOKEN       real Runtime bearer token (principal_ops_console)
 *   RUNTIME_URL              Runtime origin, e.g. https://runtime.<domain>
 * Optional:
 *   SESSION_EPOCH            integer; change to revoke all outstanding cookies
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'aion_console_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h

/** In-process revocation set (per isolate). Survives logout within the same instance. */
const revokedSids = new Set<string>();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function currentEpoch(): string {
  const raw = process.env.SESSION_EPOCH ?? '0';
  return /^\d+$/.test(raw) ? raw : '0';
}

function sign(payload: string): string {
  return createHmac('sha256', requireEnv('SESSION_SIGNING_SECRET')).update(payload).digest('hex');
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // still do a comparison so timing doesn't leak length
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function checkLoginSecret(candidate: string): boolean {
  return timingSafeStringEqual(candidate, requireEnv('CONSOLE_LOGIN_SECRET'));
}

/** Builds the signed cookie value (caller sets it with whatever cookie attributes). */
export function makeSessionCookieValue(): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const sid = randomBytes(16).toString('hex');
  const payload = `v2.${expiresAt}.${sid}.${currentEpoch()}`;
  return `${payload}.${sign(payload)}`;
}

/** Revoke a specific session id (extracted from a verified cookie). */
export function revokeSessionSid(sid: string): void {
  if (sid) revokedSids.add(sid);
}

/** Clears the in-process revocation set (tests only). */
export function clearRevokedSessionsForTests(): void {
  revokedSids.clear();
}

function parseAndVerify(raw: string): { version: string; expiresAt: number; sid: string | null } | null {
  const lastDot = raw.lastIndexOf('.');
  if (lastDot === -1) return null;
  const payload = raw.slice(0, lastDot);
  const sig = raw.slice(lastDot + 1);
  if (!timingSafeStringEqual(sig, sign(payload))) return null;

  const parts = payload.split('.');
  const version = parts[0];
  if (version === 'v1') {
    const expiresAt = Number(parts[1]);
    if (!Number.isFinite(expiresAt)) return null;
    return { version, expiresAt, sid: null };
  }
  if (version === 'v2') {
    const expiresAt = Number(parts[1]);
    const sid = parts[2] ?? '';
    const epoch = parts[3] ?? '';
    if (!Number.isFinite(expiresAt) || !sid) return null;
    if (epoch !== currentEpoch()) return null;
    if (revokedSids.has(sid)) return null;
    return { version, expiresAt, sid };
  }
  return null;
}

/** Returns true iff the given cookie value is validly-signed, unexpired, and not revoked. */
export function verifySessionCookieValue(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const parsed = parseAndVerify(raw);
  if (!parsed) return false;
  return Math.floor(Date.now() / 1000) < parsed.expiresAt;
}

/** Extract sid from a cookie for logout revocation; null if unverifiable. */
export function sessionSidFromCookie(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const parsed = parseAndVerify(raw);
  return parsed?.sid ?? null;
}
