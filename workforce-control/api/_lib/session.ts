/**
 * Session helpers for the Console BFF.
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
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const COOKIE_NAME = 'aion_console_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h

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

/** Builds a signed `name=value` Set-Cookie header value (caller adds attributes). */
export function makeSessionCookieValue(): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function setSessionCookie(res: ServerResponse): void {
  const value = makeSessionCookieValue();
  const secure = process.env.VERCEL_ENV !== 'development' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${value}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** Returns true iff the request carries a validly-signed, unexpired session cookie. */
export function hasValidSession(req: IncomingMessage): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
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
