/** Provider-neutral contracts; safe to import from browser composition. */
export type Effort = 'low' | 'medium' | 'high';

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  effort: Effort;
  model: string;
}

/**
 * Vendor-neutral completion result with RES-001 telemetry fields.
 *
 * MVP surface is text completion only (no stream / tool_call). Telemetry is
 * required so OL can distinguish stub success from live model I/O.
 */
export interface LlmResponse {
  text: string;
  /** Provider id (e.g. anthropic, openrouter) — never a secret. */
  provider: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Wall time for the provider call in milliseconds. */
  latencyMs: number;
  /** Provider-reported or estimated cost in opaque units; null if unknown. */
  costUnits: number | null;
  /** true on successful completion; false when returned via safeGenerate. */
  ok: boolean;
  /** Stable, non-secret error code when ok is false. */
  errorCode?: string | null;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Success telemetry defaults for providers that already produced text/tokens. */
export function successTelemetry(
  provider: string,
  latencyMs: number,
  costUnits: number | null = null,
): Pick<LlmResponse, 'provider' | 'latencyMs' | 'costUnits' | 'ok' | 'errorCode'> {
  return {
    provider,
    latencyMs: Math.max(0, latencyMs),
    costUnits,
    ok: true,
    errorCode: null,
  };
}

/**
 * Non-throwing generate wrapper (RES-001 spike).
 * On provider throw, returns ok:false with telemetry — never includes secrets.
 */
export async function safeGenerate(
  provider: LlmProvider,
  req: LlmRequest,
): Promise<LlmResponse> {
  const started = Date.now();
  try {
    const res = await provider.complete(req);
    return {
      ...res,
      provider: res.provider || provider.name,
      latencyMs: res.latencyMs > 0 ? res.latencyMs : Math.max(0, Date.now() - started),
      ok: true,
      errorCode: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'model_error';
    // Collapse to a short, non-secret code (strip anything that looks like a key).
    const errorCode = message
      .replace(/sk-[a-z0-9-]+/gi, '[redacted]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .slice(0, 120);
    return {
      text: '',
      provider: provider.name,
      model: req.model,
      tokensIn: null,
      tokensOut: null,
      latencyMs: Math.max(0, Date.now() - started),
      costUnits: null,
      ok: false,
      errorCode,
    };
  }
}
