import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearSessionCookie } from './_lib/session.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
}
