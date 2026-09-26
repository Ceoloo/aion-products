// Narrow browser stand-in for the node:crypto imports of canonical Core
// contracts (see vite.config.ts). Only what Core imports is provided.

// Preserve cryptographically secure Core identifiers in the isolated preview.
export const randomUUID = () => crypto.randomUUID();

/**
 * Core hashes idempotency keys server-side (Runtime owns external side effects).
 * The browser never mints them; fail loudly rather than hash differently.
 */
export function createHash(_algorithm: string): never {
  throw new Error('createHash is server-only: idempotency keys are minted by Runtime, not the browser');
}
