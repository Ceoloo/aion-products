/** Server composition: resolve environment defaults and construct HTTP transports. */
import { SharedExecutionService, type SharedExecutionConfig } from './shared-execution.ts';
import { RuntimeClient, runtimeUrlFromEnv } from './runtime-client.ts';
import type { Effort } from './provider-contracts.ts';
export type { AiExecutor, AiExecResult } from './shared-execution.ts';

export interface AiExecutionConfig extends Omit<SharedExecutionConfig, 'runtime'> {
  runtimeUrl?: string;
  runtimeFetch?: typeof fetch;
}

export class AiExecutionService extends SharedExecutionService {
  constructor(cfg: AiExecutionConfig) {
    const runtimeUrl = cfg.runtimeUrl ?? runtimeUrlFromEnv();
    super({
      ...cfg,
      model: cfg.model ?? process.env.AION_MODEL ??
        (cfg.llm?.name === 'openrouter' ? process.env.OPENROUTER_MODEL : undefined),
      effort: cfg.effort ?? process.env.AION_EFFORT as Effort | undefined,
      runtime: runtimeUrl ? new RuntimeClient({
        baseUrl: runtimeUrl,
        ...(cfg.runtimeFetch ? { fetch: cfg.runtimeFetch } : {}),
      }) : null,
    });
  }
}
