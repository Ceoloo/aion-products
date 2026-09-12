/**
 * SessionStore adapter over Runtime's revenue-sessions gateway.
 *
 * When AION_RUNTIME_URL is set, durable checkpoints/finals go through Runtime →
 * Data (optimistic concurrency via `revision`). When unset, callers keep using
 * InMemorySessionStore / JsonSessionStore for offline tests.
 */

import type { SessionRecord } from '../domain/session.ts';
import {
  RuntimeApiError,
  RuntimeClient,
  runtimeUrlFromEnv,
} from '../platform/runtime-client.ts';
import type { RevenueSessionRecord } from '../platform/runtime-contracts.ts';
import { InMemorySessionStore, JsonSessionStore, type SessionStore } from './store.ts';

function isSessionRecord(value: unknown): value is SessionRecord {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as SessionRecord).sessionId === 'string' &&
    typeof (value as SessionRecord).createdAt === 'string'
  );
}

function payloadFromRow(row: RevenueSessionRecord): SessionRecord | undefined {
  if (isSessionRecord(row.finalRecord)) return row.finalRecord;
  if (isSessionRecord(row.checkpoint)) return row.checkpoint;
  return undefined;
}

export class RuntimeRevenueSessionStore implements SessionStore {
  private readonly revisions = new Map<string, number>();
  private readonly client: RuntimeClient;

  constructor(client: RuntimeClient) {
    this.client = client;
  }
  private track(row: RevenueSessionRecord): void {
    this.revisions.set(row.sessionId, row.revision);
  }

  private async fetchRow(sessionId: string): Promise<RevenueSessionRecord | undefined> {
    try {
      const { session } = await this.client.getRevenueSession(sessionId);
      this.track(session);
      return session;
    } catch (err) {
      if (err instanceof RuntimeApiError && err.status === 404) return undefined;
      throw err;
    }
  }

  async save(record: SessionRecord): Promise<void> {
    const existing = await this.fetchRow(record.sessionId);
    if (!existing) {
      const created = await this.client.createRevenueSession({
        sessionId: record.sessionId,
        checkpoint: record.finalizedAt ? { pendingFinal: true, sessionId: record.sessionId } : record,
      });
      this.track(created.session);
      if (record.finalizedAt) {
        await this.finalize(record, created.session.revision);
      }
      return;
    }
    if (record.finalizedAt) {
      await this.finalize(record, existing.revision);
      return;
    }
    const updated = await this.client.updateRevenueSession(record.sessionId, {
      revision: existing.revision,
      checkpoint: record,
      finalRecord: null,
    });
    this.track(updated.session);
  }

  private async finalize(record: SessionRecord, revision: number): Promise<void> {
    try {
      const updated = await this.client.updateRevenueSession(record.sessionId, {
        revision,
        checkpoint: null,
        finalRecord: record,
      });
      this.track(updated.session);
    } catch (err) {
      // One retry on stale revision (concurrent writer).
      if (err instanceof RuntimeApiError && (err.status === 409 || err.code === 'stale_revision')) {
        const fresh = await this.fetchRow(record.sessionId);
        if (!fresh) throw err;
        const updated = await this.client.updateRevenueSession(record.sessionId, {
          revision: fresh.revision,
          checkpoint: null,
          finalRecord: record,
        });
        this.track(updated.session);
        return;
      }
      throw err;
    }
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const row = await this.fetchRow(sessionId);
    return row ? payloadFromRow(row) : undefined;
  }

  async list(): Promise<SessionRecord[]> {
    const [finalized, active] = await Promise.all([
      this.client.listRevenueSessions('finalized'),
      this.client.listRevenueSessions('active'),
    ]);
    const out: SessionRecord[] = [];
    const seen = new Set<string>();

    for (const row of finalized.sessions) {
      this.track(row);
      const payload = payloadFromRow(row);
      if (payload && !seen.has(payload.sessionId)) {
        seen.add(payload.sessionId);
        out.push(payload);
      }
    }

    // Active list may be ids-only — hydrate missing rows.
    for (const row of active.sessions) {
      if (seen.has(row.sessionId)) continue;
      if (isSessionRecord(row.checkpoint) || isSessionRecord(row.finalRecord)) {
        this.track(row);
        const payload = payloadFromRow(row);
        if (payload) {
          seen.add(payload.sessionId);
          out.push(payload);
        }
        continue;
      }
      const full = await this.fetchRow(row.sessionId);
      if (!full) continue;
      const payload = payloadFromRow(full);
      if (payload && !seen.has(payload.sessionId)) {
        seen.add(payload.sessionId);
        out.push(payload);
      }
    }

    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async update(record: SessionRecord): Promise<boolean> {
    const existing = await this.fetchRow(record.sessionId);
    if (!existing) return false;
    await this.save(record);
    return true;
  }

  /** Revenue-sessions gateway has no delete in P0 — return false. */
  async delete(_sessionId: string): Promise<boolean> {
    return false;
  }
}

export interface CreateSessionStoreOptions {
  dataDir?: string;
  runtimeUrl?: string | null;
  runtimeFetch?: typeof fetch;
  /** Prefer in-memory when Runtime is unset (tests). */
  preferMemory?: boolean;
}

/** Pick Runtime-backed store when URL configured; else Json/InMemory. */
export function createSessionStore(opts: CreateSessionStoreOptions = {}): SessionStore {
  const url =
    opts.runtimeUrl === null
      ? undefined
      : opts.runtimeUrl?.trim() || runtimeUrlFromEnv();
  if (url) {
    return new RuntimeRevenueSessionStore(
      new RuntimeClient({
        baseUrl: url,
        ...(opts.runtimeFetch ? { fetch: opts.runtimeFetch } : {}),
      }),
    );
  }
  if (opts.preferMemory) return new InMemorySessionStore();
  return new JsonSessionStore(opts.dataDir ?? process.env.AION_DATA_DIR ?? './data');
}
