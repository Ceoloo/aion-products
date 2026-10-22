/**
 * Inbound authentication for the Revenue Copilot HTTP service (AIO-39).
 *
 * Callers present Authorization: Bearer <token>. Tokens map to a callerId +
 * tenantId; every session is owned by that caller and listed/mutated only by
 * the same identity. Staging/production refuse to boot without keys and reject
 * AION_COPILOT_AUTH_MODE=open.
 *
 * Config (env):
 *   AION_COPILOT_AUTH_MODE=open|required
 *     open     — local only; no bearer required (tests / loopback proofs)
 *     required — bearer mandatory
 *   AION_COPILOT_API_KEYS — JSON array of
 *     { "token", "callerId", "tenantId" }
 *   AION_COPILOT_API_KEY  — single-token shorthand (callerId=default,
 *     tenantId from AION_TENANT_ID or "aion-systems")
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export type CopilotAuthMode = 'open' | 'required';

export interface CopilotCaller {
  callerId: string;
  tenantId: string;
}

export interface CopilotApiKey {
  token: string;
  caller: CopilotCaller;
}

export interface CopilotAuthConfig {
  mode: CopilotAuthMode;
  apiKeys: CopilotApiKey[];
}

export class CopilotAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopilotAuthConfigError';
  }
}

export type CopilotAuthOk = { ok: true; caller: CopilotCaller | null };
export type CopilotAuthDenied = {
  ok: false;
  status: 401 | 403;
  error: string;
  message: string;
};

function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function extractBearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || undefined;
}

function parseApiKeys(
  rawKeys: string | undefined,
  singleKey: string | undefined,
  defaultTenantId: string,
): CopilotApiKey[] {
  if (rawKeys !== undefined && rawKeys.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawKeys) as unknown;
    } catch {
      throw new CopilotAuthConfigError('AION_COPILOT_API_KEYS must be valid JSON');
    }
    if (!Array.isArray(parsed)) {
      throw new CopilotAuthConfigError('AION_COPILOT_API_KEYS must be a JSON array');
    }
    return parsed.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new CopilotAuthConfigError(
          `AION_COPILOT_API_KEYS[${index}] must be an object`,
        );
      }
      const row = entry as Record<string, unknown>;
      if (typeof row.token !== 'string' || row.token.length < 8) {
        throw new CopilotAuthConfigError(
          `AION_COPILOT_API_KEYS[${index}].token must be a string (≥ 8 chars)`,
        );
      }
      if (typeof row.callerId !== 'string' || row.callerId.length < 1) {
        throw new CopilotAuthConfigError(
          `AION_COPILOT_API_KEYS[${index}].callerId is required`,
        );
      }
      if (typeof row.tenantId !== 'string' || row.tenantId.length < 1) {
        throw new CopilotAuthConfigError(
          `AION_COPILOT_API_KEYS[${index}].tenantId is required`,
        );
      }
      return {
        token: row.token,
        caller: { callerId: row.callerId, tenantId: row.tenantId },
      };
    });
  }

  const trimmed = (singleKey ?? '').trim();
  if (trimmed.length > 0) {
    if (trimmed.length < 8) {
      throw new CopilotAuthConfigError(
        'AION_COPILOT_API_KEY must be at least 8 characters',
      );
    }
    return [
      {
        token: trimmed,
        caller: { callerId: 'default', tenantId: defaultTenantId },
      },
    ];
  }
  return [];
}

export function resolveCopilotAuthMode(
  environment: string,
  raw: string | undefined,
): CopilotAuthMode {
  const env = environment === 'staging' || environment === 'production'
    ? environment
    : 'local';
  if (raw === 'open') {
    if (env !== 'local') {
      throw new CopilotAuthConfigError(
        `AION_COPILOT_AUTH_MODE=open is not allowed in ${env} (local only)`,
      );
    }
    return 'open';
  }
  if (raw === 'required') return 'required';
  if (raw !== undefined && raw.trim() !== '') {
    throw new CopilotAuthConfigError(
      `invalid AION_COPILOT_AUTH_MODE '${raw}' (expected open|required)`,
    );
  }
  return env === 'local' ? 'open' : 'required';
}

export function loadCopilotAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): CopilotAuthConfig {
  const environment = env.AION_ENVIRONMENT ?? 'local';
  const mode = resolveCopilotAuthMode(environment, env.AION_COPILOT_AUTH_MODE);
  const defaultTenant =
    (env.AION_TENANT_ID ?? '').trim() || 'aion-systems';
  const apiKeys = parseApiKeys(
    env.AION_COPILOT_API_KEYS,
    env.AION_COPILOT_API_KEY,
    defaultTenant,
  );
  if (mode === 'required' && apiKeys.length === 0) {
    throw new CopilotAuthConfigError(
      'AION_COPILOT_AUTH_MODE=required requires AION_COPILOT_API_KEY or AION_COPILOT_API_KEYS',
    );
  }
  return { mode, apiKeys };
}

export function authenticateCopilotRequest(
  req: IncomingMessage,
  config: CopilotAuthConfig,
): CopilotAuthOk | CopilotAuthDenied {
  const token = extractBearer(req);

  if (!token) {
    if (config.mode === 'required') {
      return {
        ok: false,
        status: 401,
        error: 'auth_required',
        message: 'Authorization Bearer token is required',
      };
    }
    return { ok: true, caller: null };
  }

  const match = config.apiKeys.find((k) => tokensEqual(k.token, token));
  if (!match) {
    return {
      ok: false,
      status: 401,
      error: 'auth_invalid',
      message: 'Authorization Bearer token is invalid',
    };
  }
  return { ok: true, caller: match.caller };
}

/**
 * When a caller is bound, x-aion-tenant-id (if present) must match caller.tenantId.
 * The header is never authority on its own.
 */
export function assertCallerTenantAccess(
  caller: CopilotCaller | null,
  headerTenant: string | undefined,
): CopilotAuthDenied | null {
  if (!caller) return null;
  if (!headerTenant) return null;
  if (headerTenant === caller.tenantId) return null;
  return {
    ok: false,
    status: 403,
    error: 'tenant_forbidden',
    message: 'x-aion-tenant-id is not allowed for this caller',
  };
}

export function callerTenantFromRequest(
  req: IncomingMessage,
): string | undefined {
  const raw = req.headers['x-aion-tenant-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
