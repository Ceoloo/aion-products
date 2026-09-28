/** Durable active Copilot state, stored in Runtime's revenue-sessions row. */
import type { ContextInput } from '../engines/context.ts';
import type { CopilotCheckpoint } from '../pipeline/copilot.ts';
import type { ExecutionCheckpoint } from '../platform/shared-execution.ts';
import { RuntimeApiError, RuntimeClient } from '../platform/runtime-client.ts';

export interface ActiveSessionCheckpoint {
  version: 1;
  sessionId: string;
  callId: string;
  industry: string;
  context: ContextInput;
  createdAt: number;
  lastAccessAt: number;
  /** An interrupted mutation must be reconciled, never silently replayed. */
  inFlight: null | 'turn' | 'feedback' | 'finish';
  copilot: CopilotCheckpoint;
  execution: ExecutionCheckpoint;
}

function isCheckpoint(value: unknown): value is ActiveSessionCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ActiveSessionCheckpoint>;
  return v.version === 1 && typeof v.sessionId === 'string' &&
    typeof v.callId === 'string' && typeof v.industry === 'string' &&
    typeof v.createdAt === 'number' && typeof v.lastAccessAt === 'number' &&
    (v.inFlight === null || v.inFlight === 'turn' || v.inFlight === 'feedback' || v.inFlight === 'finish') &&
    !!v.context && !!v.copilot && !!v.execution;
}

export class RuntimeActiveSessionStore {
  private readonly client: RuntimeClient;
  constructor(client: RuntimeClient) { this.client = client; }

  async create(checkpoint: ActiveSessionCheckpoint): Promise<number> {
    const { session } = await this.client.createRevenueSession({ sessionId: checkpoint.sessionId, checkpoint });
    return session.revision;
  }

  async get(sessionId: string): Promise<{ checkpoint: ActiveSessionCheckpoint; revision: number } | undefined> {
    try {
      const { session } = await this.client.getRevenueSession(sessionId);
      if (session.finalRecord !== null || !isCheckpoint(session.checkpoint)) return undefined;
      if (session.checkpoint.sessionId !== sessionId) throw new Error('session checkpoint id mismatch');
      return { checkpoint: session.checkpoint, revision: session.revision };
    } catch (err) {
      if (err instanceof RuntimeApiError && err.status === 404) return undefined;
      throw err;
    }
  }

  async list(): Promise<Array<{ checkpoint: ActiveSessionCheckpoint; revision: number }>> {
    const { sessions } = await this.client.listRevenueSessions('active');
    const checkpoints = await Promise.all(sessions.map((row) => this.get(row.sessionId)));
    return checkpoints.filter((checkpoint): checkpoint is { checkpoint: ActiveSessionCheckpoint; revision: number } => !!checkpoint);
  }

  async save(checkpoint: ActiveSessionCheckpoint, revision: number): Promise<number> {
    // Use the revision observed when this process loaded/created the session.
    // A second process cannot silently overwrite a concurrent turn.
    const { session } = await this.client.updateRevenueSession(checkpoint.sessionId, {
      revision,
      checkpoint,
    });
    return session.revision;
  }
}
