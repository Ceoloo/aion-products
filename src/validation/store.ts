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

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionRecord } from '../domain/session.ts';

export interface SessionStore {
  save(record: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
  list(): Promise<SessionRecord[]>;
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
    await writeFile(this.path(record.sessionId), JSON.stringify(record, null, 2), 'utf8');
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
}
