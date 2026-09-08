/**
 * Session record persistence.
 *
 * A port + two adapters, mirroring @aion/core's persistence-port philosophy:
 * the harness depends on the SessionStore interface, and a durable backend
 * (future aion-data) can replace the filesystem store without touching callers.
 *
 * NOTE: real call records contain PII (transcripts, prospect data). The JSON
 * store writes under a git-ignored data directory; these files must never be
 * committed.
 */

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionRecord } from '../domain/session.ts';

export interface SessionStore {
  /** Create or replace a session record by sessionId. */
  save(record: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
  list(): Promise<SessionRecord[]>;
  /**
   * Replace an existing record. Returns false when the sessionId is unknown
   * (callers should treat that as HTTP 404 rather than silently creating).
   */
  update(record: SessionRecord): Promise<boolean>;
  /** Remove a persisted record. Returns false when nothing was deleted. */
  delete(sessionId: string): Promise<boolean>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionRecord>();

  async save(record: SessionRecord): Promise<void> {
    this.records.set(record.sessionId, structuredClone(record));
  }
  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const r = this.records.get(sessionId);
    return r ? structuredClone(r) : undefined;
  }
  async list(): Promise<SessionRecord[]> {
    return [...this.records.values()].map((r) => structuredClone(r));
  }
  async update(record: SessionRecord): Promise<boolean> {
    if (!this.records.has(record.sessionId)) return false;
    this.records.set(record.sessionId, structuredClone(record));
    return true;
  }
  async delete(sessionId: string): Promise<boolean> {
    return this.records.delete(sessionId);
  }
}

export class JsonSessionStore implements SessionStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'sessions');
  }

  private path(id: string): string {
    // Guard against path traversal in session ids.
    const safe = id.replace(/[^A-Za-z0-9_.-]/g, '_');
    return join(this.dir, `${safe}.json`);
  }

  async save(record: SessionRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    // Atomic write: write a temp file, then rename over the final path so a
    // crash mid-write can never leave a half-written (and thus skipped) record.
    const final = this.path(record.sessionId);
    const tmp = `${final}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
    await rename(tmp, final);
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.path(sessionId), 'utf8')) as SessionRecord;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<SessionRecord[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: SessionRecord[] = [];
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      try {
        out.push(JSON.parse(await readFile(join(this.dir, f), 'utf8')) as SessionRecord);
      } catch {
        /* skip unreadable/corrupt files */
      }
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async update(record: SessionRecord): Promise<boolean> {
    if ((await this.get(record.sessionId)) === undefined) return false;
    await this.save(record);
    return true;
  }

  async delete(sessionId: string): Promise<boolean> {
    try {
      await unlink(this.path(sessionId));
      return true;
    } catch {
      return false;
    }
  }
}
