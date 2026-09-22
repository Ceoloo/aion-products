/**
 * Console BFF — Hono backend service (Vercel Services, root=server).
 *
 * Replaces an earlier file-based api/*.ts implementation, which had an
 * unresolved routing bug where the dynamic catch-all (api/runtime/[...path].ts)
 * inconsistently failed to match multi-segment paths across three different
 * vercel.json configurations. Current Vercel guidance calls file-based api/
 * routing an anti-pattern for backend logic in favor of one framework app
 * entrypoint Vercel introspects directly — this is that entrypoint.
 *
 * The browser never holds a Runtime bearer token: it only gets an httpOnly
 * session cookie from /api/login. /api/runtime/* verifies that cookie, then
 * attaches the real token server-side before forwarding to Runtime.
 */
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  checkLoginSecret,
  makeSessionCookieValue,
  verifySessionCookieValue,
} from './lib/session.js';

const app = new Hono();

app.get('/api/session', (c) => {
  const raw = getCookie(c, SESSION_COOKIE_NAME);
  return c.json({ authenticated: verifySessionCookieValue(raw) });
});

app.post('/api/login', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (!secret || !checkLoginSecret(secret)) {
    return c.json({ error: 'invalid_secret' }, 401);
  }
  setCookie(c, SESSION_COOKIE_NAME, makeSessionCookieValue(), {
    httpOnly: true,
    secure: process.env.VERCEL_ENV !== 'development',
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.json({ ok: true });
});

app.post('/api/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

/**
 * The one BFF proxy route. Covers reads and writes alike so the client's
 * runtime-api.ts never needs a second, duplicate implementation.
 */
app.all('/api/runtime/*', async (c) => {
  const raw = getCookie(c, SESSION_COOKIE_NAME);
  if (!verifySessionCookieValue(raw)) {
    return c.json({ error: 'not_authenticated' }, 401);
  }

  const runtimeUrl = process.env.RUNTIME_URL;
  const gatewayToken = process.env.AION_GATEWAY_TOKEN;
  if (!runtimeUrl || !gatewayToken) {
    return c.json({ error: 'bff_misconfigured', message: 'RUNTIME_URL / AION_GATEWAY_TOKEN not set' }, 500);
  }

  // c.req.param('*') was observed resolving to empty in production for every
  // request regardless of the real path (root cause of a prior live bug —
  // every call silently hit RUNTIME_URL's root instead of the real path).
  // Stripping the known prefix from c.req.path directly is unambiguous.
  const pathStr = c.req.path.replace(/^\/api\/runtime\//, '');
  const qs = c.req.query();
  const qsStr = Object.keys(qs).length ? `?${new URLSearchParams(qs).toString()}` : '';
  const target = `${runtimeUrl.replace(/\/$/, '')}/${pathStr}${qsStr}`;

  const tenantId = c.req.header('x-aion-tenant-id');
  const method = c.req.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const bodyText = hasBody ? await c.req.text() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        ...(tenantId ? { 'x-aion-tenant-id': tenantId } : {}),
        ...(bodyText ? { 'content-type': 'application/json' } : {}),
      },
      body: bodyText,
    });
  } catch (err) {
    return c.json(
      { error: 'runtime_unreachable', message: err instanceof Error ? err.message : String(err) },
      502,
    );
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get('content-type') ?? 'application/json';
  return c.body(text, upstream.status as 200, { 'content-type': contentType });
});

export default app;
