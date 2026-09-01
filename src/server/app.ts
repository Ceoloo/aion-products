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
import { dirname, join } from 'node:path';

import { createCopilot, buildReport } from '../aion.ts';
import { getSchema, listSchemas } from '../config/registry.ts';
import type { AiExecutionService } from '../platform/ai-execution.ts';
import type { LiveCopilot } from '../pipeline/copilot.ts';
import type { ContextInput } from '../engines/context.ts';
import type { Turn } from '../domain/types.ts';
import type { GroundTruth } from '../domain/session.ts';
import { suggestEvaluable, suggestKind } from '../domain/session.ts';
import { parseTranscript } from '../validation/transcript.ts';
import { JsonSessionStore } from '../validation/store.ts';
import { assembleSessionRecord } from '../validation/record.ts';
import { buildDashboard, scoreRecord } from '../validation/scoring.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const DATA_DIR = process.env.AION_DATA_DIR ?? join(process.cwd(), 'data');
const store = new JsonSessionStore(DATA_DIR);

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

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // Static console.
  if (method === 'GET' && (path === '/' || path === '/index.html')) {
    const html = await readFile(join(HERE, 'console.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
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
    });
    json(res, 200, { sessionId, briefing: copilot.context.briefing, aiPath: exec.llmAvailable() ? 'claude' : 'deterministic' });
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

    if (action === 'ingest' && method === 'POST') {
      // Accept either a pasted transcript, a batch of turns, or a single turn.
      let turns: Turn[] = [];
      if (typeof body.transcript === 'string') {
        turns = parseTranscript(body.transcript).map((t) => ({ ...t, index: s.turnIndex++ }));
      } else if (Array.isArray(body.turns)) {
        turns = body.turns.map((t: any) => ({ index: s.turnIndex++, speaker: t.speaker === 'rep' ? 'rep' : t.speaker === 'system' ? 'system' : 'prospect', text: String(t.text ?? '') }));
      } else if (body.text) {
        turns = [{ index: s.turnIndex++, speaker: body.speaker === 'rep' ? 'rep' : 'prospect', text: String(body.text) }];
      }
      let last = null;
      for (const t of turns) {
        if (t.text.trim()) last = await s.copilot.ingest(t);
      }
      const state = s.copilot.currentState();
      json(res, 200, { update: last, state, recommendations: last?.recommendations ?? [], ingested: turns.length });
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
      const report = buildReport(s.copilot, s.exec, getSchema(s.industry));
      const gt: GroundTruth | null = body.groundTruth ?? null;
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
      await store.save(record);
      live.delete(s.sessionId);
      json(res, 200, { saved: true, sessionId: record.sessionId, kind: record.kind, evaluable: record.evaluable, score: scoreRecord(record), outcome: record.after.aiOutcome });
      return;
    }
  }

  if (method === 'GET' && path === '/api/dashboard') {
    const records = await store.list();
    const metrics = buildDashboard(records);
    json(res, 200, {
      metrics,
      records: records.map((r) => ({
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
      })),
    });
    return;
  }

  json(res, 404, { error: 'not found' });
}

export function start(): void {
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    });
  });
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`AION Validation Console → http://localhost:${PORT}  (data dir: ${DATA_DIR})`);
  });
}

// Auto-start unless imported for tests.
if (process.env.AION_CONSOLE_NO_AUTOSTART !== '1') {
  start();
}

export { handle, buildContext };
export { suggestEvaluable, suggestKind };
