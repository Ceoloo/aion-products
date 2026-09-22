import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkLoginSecret, setSessionCookie } from './_lib/session.js';

/**
 * POST /api/login — body: { secret: string }.
 * On match, sets an httpOnly signed session cookie. No rate limiting here:
 * this is a single-operator console gated by a high-entropy shared secret
 * the operator controls the strength of, not a multi-user auth system.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const secret = typeof req.body?.secret === 'string' ? req.body.secret : '';
  if (!secret || !checkLoginSecret(secret)) {
    res.status(401).json({ error: 'invalid_secret' });
    return;
  }
  setSessionCookie(res);
  res.status(200).json({ ok: true });
}
