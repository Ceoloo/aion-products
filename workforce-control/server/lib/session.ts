/**
 * Session helpers for the Console BFF (Hono backend service).
 *
 * The browser never sees a Runtime bearer token or the login secret — it
 * only ever holds an httpOnly session cookie. This file signs/verifies that
 * cookie with HMAC-SHA256 (no JWT library needed for a single-purpose,
 * single-claim token) and centralizes the few required env vars.
 *
 * Required env (Vercel project settings — server-only, never VITE_*):
 *   CONSOLE_LOGIN_SECRET     shared secret the operator enters to sign in
 *   SESSION_SIGNING_SECRET   HMAC key for signing session cookies
 *   AION_GATEWAY_TOKEN       real Runtime bearer token (principal_ops_console)
 *   RUNTIME_URL              Runtime origin, e.g. https://runtime.<domain>
 *
 * Pure string-in/string-out functions — framework-agnostic, no req/res
 * coupling, so they work the same under Hono, tests, or anything else.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'aion_console_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
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
  const payload = `v1.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns true iff the given cookie value is validly-signed and unexpired. */
export function verifySessionCookieValue(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const lastDot = raw.lastIndexOf('.');
  if (lastDot === -1) return false;
  const payload = raw.slice(0, lastDot);
  const sig = raw.slice(lastDot + 1);
  if (!timingSafeStringEqual(sig, sign(payload))) return false;
  const [version, expiresAtStr] = payload.split('.');
  if (version !== 'v1') return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt)) return false;
  return Math.floor(Date.now() / 1000) < expiresAt;
}
