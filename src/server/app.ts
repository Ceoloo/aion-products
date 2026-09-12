/**
 * MISSION-001 Validation Console — server.
 *
 * A dependency-free Node HTTP server that hosts the governed Revenue Copilot
 * pipeline behind a small API and serves the browser console. The pipeline runs
 * server-side (it uses @aion/core + the Anthropic SDK); the browser is only the
 * operator surface. Real call records persist to a git-ignored data directory.
 *
 *   node src/server/app.ts        (or: npm run console)
 *   PORT=4173 AION_DATA_DIR=./data
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

import { createCopilot, buildReport } from '../aion.ts';
import { getSchema, listSchemas } from '../config/registry.ts';
import type { AiExecutionService } from '../platform/ai-execution.ts';
import type { LiveCopilot } from '../pipeline/copilot.ts';
import type { ContextInput } from '../engines/context.ts';
import type { Turn } from '../domain/types.ts';
import type { GroundTruth, ConfirmedOutcome } from '../domain/session.ts';
import { suggestEvaluable, suggestKind } from '../domain/session.ts';
import { parseTranscript } from '../validation/transcript.ts';
import { classifyLiveUtterance } from '../validation/speaker-roles.ts';
import { type SessionStore } from '../validation/store.ts';
import { createSessionStore } from '../validation/runtime-session-store.ts';
import { assembleSessionRecord, applyGroundTruthToRecord } from '../validation/record.ts';
import { buildDashboard, scoreRecord } from '../validation/scoring.ts';
import { gatherReadiness } from '../validation/readiness.ts';
import type { SessionRecord } from '../domain/session.ts';
import {
  buildCallOutcomeAttribution,
  publishCallOutcome,
} from '../platform/outcome.ts';
import { RuntimeClient, resolveRuntimeUrl } from '../platform/runtime-client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
// Bind to loopback by default; the routes are unauthenticated and handle PII.
// For handheld/LAN use, set AION_HOST=0.0.0.0 AND AION_TOKEN=<secret> (the
// operator then opens http://<lan-ip>:PORT/?token=<secret> on the phone).
const HOST = process.env.AION_HOST ?? '127.0.0.1';
const TOKEN = (process.env.AION_TOKEN ?? '').trim();
const DATA_DIR = process.env.AION_DATA_DIR ?? join(process.cwd(), 'data');
/** Runtime-backed when AION_RUNTIME_URL is set; else Json under DATA_DIR. */
let store: SessionStore = createSessionStore({ dataDir: DATA_DIR });
const RUNTIME_URL = resolveRuntimeUrl();
const runtimeClient = RUNTIME_URL ? new RuntimeClient({ baseUrl: RUNTIME_URL }) : null;

// Whitelists for validating operator-supplied ground truth (defence in depth;
// combined with escaping on render, this blocks stored XSS / garbage records).
const DISPOSITIONS = new Set(['no_contact', 'gatekeeper', 'instant_rejection', 'bad_timing', 'existing_provider', 'rate_first', 'callback', 'conversation', 'other']);
const OUTCOMES = new Set(['no_contact', 'engaged', 'qualified', 'follow_up', 'application', 'appointment', 'proposal', 'demo', 'other_conversion', 'closed', 'disqualified']);
const GUIDANCE = new Set(['useful', 'acted_on', 'ignored', 'wrong', 'mixed']);
const VERDICTS = new Set(['correct', 'incorrect', 'edited', 'not_applicable']);
const GT_FIELDS = ['pain', 'urgency', 'authority', 'objection', 'conversation_stage', 'buying_signals'];
const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** Coerce/whitelist operator-supplied ground truth into a safe GroundTruth. */
function sanitizeGroundTruth(raw: unknown): GroundTruth | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const fields: GroundTruth['fields'] = {};
  if (r.fields && typeof r.fields === 'object') {
    for (const k of GT_FIELDS) {
      const v = r.fields[k];
      if (v && VERDICTS.has(v.verdict)) {
        fields[k as keyof GroundTruth['fields']] = v.verdict === 'edited' && typeof v.corrected === 'string' ? { verdict: v.verdict, corrected: str(v.corrected, 500) } : { verdict: v.verdict };
      }
    }
  }
  const downstream: ConfirmedOutcome | null =
    typeof r.downstreamConversion === 'string' && OUTCOMES.has(r.downstreamConversion) ? (r.downstreamConversion as ConfirmedOutcome) : null;
  return {
    fields,
    guidance: GUIDANCE.has(r.guidance) ? r.guidance : null,
    outcome: OUTCOMES.has(r.outcome) ? r.outcome : 'no_contact',
    advanced: r.advanced === true,
    downstreamConversion: downstream,
    disposition: DISPOSITIONS.has(r.disposition) ? r.disposition : 'other',
    evaluable: r.evaluable === true,
    ...(typeof r.nextAction === 'string' ? { nextAction: str(r.nextAction) } : {}),
    ...(typeof r.revenueOutcome === 'string' ? { revenueOutcome: str(r.revenueOutcome) } : {}),
    notes: str(r.notes),
  };
}

interface LiveSession {
  sessionId: string;
  prospectId: string;
  repId: string;
  industry: string;
  createdAt: string;
  context: ContextInput;
  copilot: LiveCopilot;
  exec: AiExecutionService;
  turnIndex: number;
  finalizing: boolean;
}

const live = new Map<string, LiveSession>();

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildContext(payload: any, industry: string): ContextInput {
  const schema = getSchema(industry);
  const stages = schema.ladder.stages;
  const first = stages[0]!.id;
  const conversionStageId = payload.conversionStageId ?? first;
  const desiredNextStageId =
    payload.desiredNextStageId ?? stages.find((s) => s.meaningfulConversion)?.id ?? stages[Math.min(1, stages.length - 1)]!.id;
  const list = (v: unknown): string[] =>
    typeof v === 'string' ? v.split(/[;\n]/).map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : [];
  return {
    prospect: {
      id: payload.prospectId || id('acct'),
      name: payload.prospectName || 'Unknown prospect',
      ...(payload.role ? { role: payload.role } : {}),
      ...(payload.company ? { company: payload.company } : {}),
    },
    company: { name: payload.company || 'Unknown company', ...(payload.companyIndustry ? { industry: payload.companyIndustry } : {}) },
    offer: {
      name: payload.offerName || schema.label,
      summary: payload.offerSummary || '',
      constraints: list(payload.offerConstraints),
      differentiators: list(payload.offerDifferentiators),
    },
    crmState: typeof payload.crmState === 'object' && payload.crmState ? payload.crmState : {},
    priorConversations: [],
    priorObjections: list(payload.priorObjections),
    outstandingQuestions: list(payload.outstandingQuestions),
    knownFacts: {},
    conversionStageId,
    desiredNextStageId,
  };
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

/** Dashboard-row summary for a persisted SessionRecord. */
function summarizeRecord(r: SessionRecord) {
  return {
    sessionId: r.sessionId,
    createdAt: r.createdAt,
    prospect: r.before.context.prospect.name,
    industry: r.industry,
    kind: r.kind,
    disposition: r.disposition,
    evaluable: r.evaluable,
    finalized: r.finalizedAt !== null,
    outcome: r.after.groundTruth?.outcome ?? null,
    advanced: r.after.groundTruth?.advanced ?? r.after.aiOutcome.advanced,
    aiStage: `${r.after.aiOutcome.stageBeforeId}→${r.after.aiOutcome.stageAfterId}`,
  };
}

/**
 * After finalize: when Runtime is configured and the call produced durable
 * run ids, POST a business outcome. Failures are logged but do not roll back
 * the persisted session record.
 */
async function maybePublishOutcome(
  exec: AiExecutionService,
  record: SessionRecord,
): Promise<{ outcomeId?: string; skipped?: string } | null> {
  if (!runtimeClient) return { skipped: 'runtime_unset' };
  const ids = exec.attributionIds();
  if (ids.runIds.length === 0) return { skipped: 'no_run_ids' };
  const advanced =
    record.after.groundTruth?.advanced ?? record.after.aiOutcome.advanced;
  const attribution = buildCallOutcomeAttribution({
    callId: record.sessionId,
    runIds: ids.runIds,
    executionIds: ids.executionIds,
    totalCostUnits: ids.totalCostUnits,
    ...(ids.totalTokens !== undefined ? { totalTokens: ids.totalTokens } : {}),
    advanced,
    stageBeforeId: record.after.aiOutcome.stageBeforeId,
    stageAfterId: record.after.aiOutcome.stageAfterId,
    summary: record.after.groundTruth?.revenueOutcome,
  });
  try {
    const outcome = await publishCallOutcome(runtimeClient, attribution);
    return outcome ? { outcomeId: outcome.outcomeId } : { skipped: 'no_run_ids' };
  } catch (e) {
    console.warn(
      `outcome publish failed for ${record.sessionId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { skipped: 'publish_failed' };
  }
}

// Built SPA lives at <repo>/web/dist; HERE is <repo>/src/server.
const WEB_DIST = resolve(HERE, '..', '..', 'web', 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
};

/**
 * Serve the built SPA (index.html + hashed /assets/*). Returns true if the
 * request was answered. For '/' and '/index.html', falls back to the
 * dependency-free console.html when web/dist has not been built.
 */
async function serveStatic(res: ServerResponse, path: string): Promise<boolean> {
  if (path === '/' || path === '/index.html') {
    try {
      const html = await readFile(join(WEB_DIST, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(html);
      return true;
    } catch {
      const html = await readFile(join(HERE, 'console.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(html);
      return true;
    }
  }
  // Hashed assets: resolve under web/dist and reject any path traversal.
  const target = resolve(WEB_DIST, '.' + path);
  if (target !== WEB_DIST && !target.startsWith(WEB_DIST + sep)) return false;
  try {
    const buf = await readFile(target);
    const ext = target.slice(target.lastIndexOf('.'));
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    });
    res.end(buf);
    return true;
  } catch {
    return false;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // Token gate for the API when AION_TOKEN is set (required for safe LAN use).
  // The console page itself loads without a token and forwards it on API calls.
  if (TOKEN && path.startsWith('/api/')) {
    const provided = req.headers['x-aion-token'] ?? url.searchParams.get('token') ?? '';
    if (provided !== TOKEN) {
      json(res, 401, { error: 'unauthorized (missing or invalid token)' });
      return;
    }
  }

  // Static console. Prefer the built shadcn SPA (web/dist); fall back to the
  // dependency-free console.html when the SPA has not been built.
  if (method === 'GET' && (path === '/' || path === '/index.html' || path.startsWith('/assets/'))) {
    if (await serveStatic(res, path)) return;
  }

  if (method === 'GET' && path === '/api/health') {
    // Production readiness for a real call. Runs the same preflight the CLI uses,
    // reflecting THIS server's bind host/token/data-dir. No secrets are returned.
    const report = await gatherReadiness({ host: HOST, token: TOKEN, dataDir: DATA_DIR });
    json(res, report.ready ? 200 : 503, report);
    return;
  }

  if (method === 'GET' && path === '/api/schemas') {
    json(res, 200, {
      schemas: listSchemas().map((s) => ({
        key: s.key,
        label: s.label,
        conversionEventNoun: s.terminology.conversionEventNoun,
        stages: s.ladder.stages.map((st) => ({ id: st.id, label: st.label, order: st.order, meaningful: st.meaningfulConversion })),
      })),
    });
    return;
  }

  if (method === 'POST' && path === '/api/session') {
    const body = await readBody(req);
    const industry = body.industry ?? 'funding';
    try {
      getSchema(industry);
    } catch {
      json(res, 400, { error: `unknown industry "${industry}"` });
      return;
    }
    const context = buildContext(body, industry);
    const sessionId = id('sess');
    const { copilot, exec } = await createCopilot({ callId: sessionId, industry, context });
    live.set(sessionId, {
      sessionId,
      prospectId: context.prospect.id,
      repId: body.repId || 'rep_local',
      industry,
      createdAt: new Date().toISOString(),
      context,
      copilot,
      exec,
      turnIndex: 0,
      finalizing: false,
    });
    json(res, 200, { sessionId, briefing: copilot.context.briefing, aiPath: exec.llmAvailable() ? 'claude' : 'deterministic' });
    return;
  }

  // Abandon a live (in-memory) session without persisting a record.
  const liveIdMatch = path.match(/^\/api\/session\/([^/]+)$/);
  if (method === 'DELETE' && liveIdMatch) {
    const sessionId = decodeURIComponent(liveIdMatch[1]!);
    if (!live.has(sessionId)) {
      json(res, 404, { error: 'live session not found' });
      return;
    }
    live.delete(sessionId);
    json(res, 200, { deleted: true, sessionId, scope: 'live' });
    return;
  }

  const m = path.match(/^\/api\/session\/([^/]+)\/(ingest|feedback|finalize|state)$/);
  if (m) {
    const s = live.get(m[1]!);
    if (!s) {
      json(res, 404, { error: 'session not found (it may have been finalized)' });
      return;
    }
    const action = m[2];
    const body = await readBody(req);

    // Reject mutations while the session is being finalized so a late turn
    // can't land after the canonical record was assembled — and so a second
    // finalize can't race the first and overwrite its record with different
    // ground truth. (The finalize handler clears `finalizing` on a persistence
    // error, so a genuine retry is still possible.)
    if (s.finalizing && (action === 'ingest' || action === 'feedback' || action === 'finalize')) {
      json(res, 409, { error: 'session is finalizing' });
      return;
    }

    if (action === 'ingest' && method === 'POST') {
      // Accept either a pasted transcript, a batch of turns, or a single turn.
      let turns: Turn[] = [];
      if (typeof body.transcript === 'string') {
        turns = parseTranscript(body.transcript).map((t) => ({ ...t, index: s.turnIndex++ }));
      } else if (Array.isArray(body.turns)) {
        turns = body.turns.map((t: any) => ({ index: s.turnIndex++, speaker: t.speaker === 'rep' ? 'rep' : t.speaker === 'system' ? 'system' : 'prospect', text: String(t.text ?? '') }));
      } else if (body.text) {
        // Single live turn. If the speaker isn't tagged (or is "auto"), infer
        // the role from the utterance + who spoke last (turn-taking).
        let speaker: Turn['speaker'];
        if (body.speaker === 'rep' || body.speaker === 'prospect') {
          speaker = body.speaker;
        } else {
          const prev = [...s.copilot.getTranscript()].reverse().find((t) => t.speaker !== 'system');
          speaker = classifyLiveUtterance(String(body.text), prev ? (prev.speaker as 'rep' | 'prospect') : null).role;
        }
        turns = [{ index: s.turnIndex++, speaker, text: String(body.text) }];
      }
      let last = null;
      let accepted = 0;
      for (const t of turns) {
        if (t.text.trim()) { last = await s.copilot.ingest(t); accepted += 1; }
      }
      const state = s.copilot.currentState();
      json(res, 200, { update: last, state, recommendations: last?.recommendations ?? [], ingested: accepted, turns });
      return;
    }

    if (action === 'feedback' && method === 'POST') {
      if (body.recommendationId && body.feedback) {
        s.copilot.recordFeedback(String(body.recommendationId), body.feedback, Number(body.atTurn ?? s.turnIndex));
      }
      json(res, 200, { ok: true });
      return;
    }

    if (action === 'state' && method === 'GET') {
      json(res, 200, { state: s.copilot.currentState(), transcript: s.copilot.getTranscript() });
      return;
    }

    if (action === 'finalize' && method === 'POST') {
      s.finalizing = true; // freeze the session against concurrent ingest/feedback
      const report = buildReport(s.copilot, s.exec, getSchema(s.industry));
      const gt = sanitizeGroundTruth(body.groundTruth);
      const record = assembleSessionRecord({
        sessionId: s.sessionId,
        prospectId: s.prospectId,
        repId: s.repId,
        industry: s.industry,
        createdAt: s.createdAt,
        context: s.context,
        copilot: s.copilot,
        report,
        groundTruth: gt,
      });
      try {
        await store.save(record);
      } catch (e) {
        s.finalizing = false; // allow a retry; keep the live session intact
        json(res, 500, { error: `failed to persist record: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
      const published = await maybePublishOutcome(s.exec, record);
      live.delete(s.sessionId);
      json(res, 200, {
        saved: true,
        sessionId: record.sessionId,
        kind: record.kind,
        evaluable: record.evaluable,
        score: scoreRecord(record),
        outcome: record.after.aiOutcome,
        ...(published ? { businessOutcome: published } : {}),
      });
      return;
    }
  }

  // ── Persisted SessionRecord CRUD ─────────────────────────────────────
  // Plural /api/sessions* routes operate on durable records (Create happens
  // via finalize; Read/Update/Delete are here). Distinct from singular
  // /api/session* which is the live in-memory turn stream.

  if (method === 'GET' && path === '/api/sessions') {
    const records = await store.list();
    const full = url.searchParams.get('full') === '1' || url.searchParams.get('full') === 'true';
    json(res, 200, {
      records: full ? records : records.map(summarizeRecord),
      count: records.length,
    });
    return;
  }

  const persistedMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (persistedMatch) {
    const sessionId = decodeURIComponent(persistedMatch[1]!);

    if (method === 'GET') {
      const record = await store.get(sessionId);
      if (!record) {
        json(res, 404, { error: 'session record not found' });
        return;
      }
      json(res, 200, { record, score: scoreRecord(record), summary: summarizeRecord(record) });
      return;
    }

    if (method === 'PATCH') {
      const existing = await store.get(sessionId);
      if (!existing) {
        json(res, 404, { error: 'session record not found' });
        return;
      }
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || !('groundTruth' in body)) {
        json(res, 400, { error: 'body must include groundTruth (object or null to clear)' });
        return;
      }
      if (body.groundTruth === null) {
        const cleared = applyGroundTruthToRecord(existing, null);
        const ok = await store.update(cleared);
        if (!ok) {
          json(res, 404, { error: 'session record not found' });
          return;
        }
        json(res, 200, { updated: true, record: cleared, score: scoreRecord(cleared), summary: summarizeRecord(cleared) });
        return;
      }
      const gt = sanitizeGroundTruth(body.groundTruth);
      if (!gt) {
        json(res, 400, { error: 'groundTruth must be an object or null' });
        return;
      }
      const updated = applyGroundTruthToRecord(existing, gt);
      const ok = await store.update(updated);
      if (!ok) {
        json(res, 404, { error: 'session record not found' });
        return;
      }
      json(res, 200, { updated: true, record: updated, score: scoreRecord(updated), summary: summarizeRecord(updated) });
      return;
    }

    if (method === 'DELETE') {
      const ok = await store.delete(sessionId);
      if (!ok) {
        json(res, 404, { error: 'session record not found' });
        return;
      }
      json(res, 200, { deleted: true, sessionId, scope: 'persisted' });
      return;
    }
  }

  if (method === 'GET' && path === '/api/dashboard') {
    const records = await store.list();
    const metrics = buildDashboard(records);
    json(res, 200, {
      metrics,
      records: records.map(summarizeRecord),
    });
    return;
  }

  json(res, 404, { error: 'not found' });
}

/** Warn if the data dir resolves inside the repo but isn't the git-ignored default. */
function warnIfDataDirCommittable(): void {
  const resolved = resolve(DATA_DIR);
  const repo = resolve(process.cwd());
  // Treat the repo root itself as "inside" (AION_DATA_DIR=. resolves to repo,
  // and JsonSessionStore would then write PII to <repo>/sessions).
  const insideRepo = resolved === repo || resolved.startsWith(repo + sep);
  const isDefaultIgnored = resolved === resolve(repo, 'data');
  if (insideRepo && !isDefaultIgnored) {
    console.warn(`⚠ AION_DATA_DIR (${resolved}) is inside the repo but not the git-ignored 'data/' path — real PII records could be committed. Point it outside the repo.`);
  }
}

export function start(): void {
  warnIfDataDirCommittable();
  const loopback = HOST === '127.0.0.1' || HOST === '::1' || HOST === 'localhost';
  if (!loopback && !TOKEN) {
    console.warn(`⚠ Binding to ${HOST} without AION_TOKEN — unauthenticated routes handling PII would be reachable on the network. Set AION_TOKEN=<secret> (open /?token=<secret>) or use a trusted network/tunnel.`);
  }
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    });
  });
  server.listen(PORT, HOST, () => {
    // Token travels in the URL fragment (never the request line); paste the real
    // AION_TOKEN in place of <AION_TOKEN>.
    console.log(`AION Validation Console → http://${loopback ? 'localhost' : HOST}:${PORT}/${TOKEN ? '#token=<AION_TOKEN>' : ''}  (data dir: ${DATA_DIR})`);
    gatherReadiness({ host: HOST, token: TOKEN, dataDir: DATA_DIR })
      .then((r) => {
        const blockers = r.checks.filter((c) => c.level === 'blocker');
        if (blockers.length) {
          console.warn(`⚠ NOT READY for a real call — ${blockers.length} blocker(s): ${blockers.map((b) => b.title).join(', ')}. Run \`npm run preflight\` for details.`);
        } else {
          console.log(`Readiness: READY (${r.aiPath === 'claude' ? 'Claude' : 'deterministic'} path). Runbook: docs/FIRST-CALL.md`);
        }
      })
      .catch(() => {});
  });
}

// Auto-start unless imported for tests.
if (process.env.AION_CONSOLE_NO_AUTOSTART !== '1') {
  start();
}

export { handle, buildContext };
export { suggestEvaluable, suggestKind };
/** Test-only: swap the SessionStore (in-memory preferred). */
export function setSessionStoreForTests(next: SessionStore): void {
  store = next;
}
