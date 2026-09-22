import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hasValidSession } from './_lib/session.js';

/** GET /api/session — lets the frontend ask "am I signed in?" without probing Runtime. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ authenticated: hasValidSession(req) });
}
