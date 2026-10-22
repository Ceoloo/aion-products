/**
 * Bounded request-body reader. Returns 413 semantics via BodyTooLargeError
 * when the accumulated payload exceeds maxBytes (including chunked bodies).
 */
import type { IncomingMessage } from 'node:http';

export class BodyTooLargeError extends Error {
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    super(`request body exceeds ${maxBytes} bytes`);
    this.name = 'BodyTooLargeError';
    this.maxBytes = maxBytes;
  }
}

/** Default max body for Copilot session/turn payloads (1 MiB). */
export const DEFAULT_MAX_BODY_BYTES = 1_048_576;

export function readBodyLimited(
  req: IncomingMessage,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    let oversized = false;

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on('data', (chunk: Buffer | string) => {
      if (oversized || settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        // Stop buffering; keep the socket alive so the handler can return 413.
        oversized = true;
        chunks.length = 0;
        fail(new BodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => fail(err));
  });
}
