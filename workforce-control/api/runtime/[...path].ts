import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hasValidSession } from '../_lib/session.js';

/**
 * ALL /api/runtime/* — the one BFF proxy route. Verifies the session cookie,
 * then forwards to the real Runtime with the real bearer token attached
 * server-side. Covers both reads and writes so runtime-api.ts on the client
 * never needs a second implementation.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!hasValidSession(req)) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }

  const runtimeUrl = process.env.RUNTIME_URL;
  const gatewayToken = process.env.AION_GATEWAY_TOKEN;
  if (!runtimeUrl || !gatewayToken) {
    res.status(500).json({ error: 'bff_misconfigured', message: 'RUNTIME_URL / AION_GATEWAY_TOKEN not set' });
    return;
  }

  const segments = req.query.path;
  const pathStr = Array.isArray(segments) ? segments.join('/') : (segments ?? '');
  const qs = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const target = `${runtimeUrl.replace(/\/$/, '')}/${pathStr}${qs}`;

  const tenantId = typeof req.headers['x-aion-tenant-id'] === 'string' ? req.headers['x-aion-tenant-id'] : undefined;

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        ...(tenantId ? { 'x-aion-tenant-id': tenantId } : {}),
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(req.body) : undefined,
    });
  } catch (err) {
    res.status(502).json({ error: 'runtime_unreachable', message: err instanceof Error ? err.message : String(err) });
    return;
  }

  const text = await upstream.text();
  res.status(upstream.status);
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('content-type', contentType);
  res.send(text);
}
