/** Isolated browser test adapter. Uses the actual product/Core engine, never a model key.
 * No network persistence: finalized sample records are scoped to this browser tab.
 * The normal server API remains the default outside Vite's explicit preview mode.
 */
import { composeCopilot } from '../../../src/compose-copilot.ts';
import { buildReport } from '../../../src/pipeline/report.ts';
import { getSchema, listSchemas } from '../../../src/config/registry.ts';
import { parseTranscript } from '../../../src/validation/transcript.ts';
import { classifyLiveUtterance } from '../../../src/validation/speaker-roles.ts';
import { assembleSessionRecord, applyGroundTruthToRecord } from '../../../src/validation/record.ts';
import { buildDashboard, scoreRecord } from '../../../src/validation/scoring.ts';
import type { SessionRecord } from '../../../src/domain/session.ts';
import type { Turn } from '../../../src/domain/types.ts';
import { buildContext } from './preview-context.ts';

const KEY = 'aion-preview-test-records-v1';
type Session = Awaited<ReturnType<typeof composeCopilot>> & {
  sessionId: string; prospectId: string; repId: string; industry: string;
  createdAt: string; context: ReturnType<typeof buildContext>; turnIndex: number;
};
const live = new Map<string, Session>();
const pending = new Map<string, Promise<unknown>>();

// Serialize reads/mutations per session. Finalization cannot overtake an ingest.
async function inSession<T>(id: string, action: () => Promise<T>): Promise<T> {
  const previous = pending.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  pending.set(id, next);
  try { return await next; }
  finally { if (pending.get(id) === next) pending.delete(id); }
}
function records(): SessionRecord[] {
  const data = sessionStorage.getItem(KEY);
  if (!data) return [];
  const parsed = JSON.parse(data);
  if (!Array.isArray(parsed)) throw new Error('Invalid preview records. Clear this tab’s session storage to reset.');
  // Older records in this preview-only namespace are synthetic too.
  return parsed.map(record => ({ ...record, synthetic: true }));
}

function summarize(r: SessionRecord) {
  return {
    synthetic: true, sessionId: r.sessionId, createdAt: r.createdAt,
    prospect: r.before.context.prospect.name, industry: r.industry, kind: r.kind,
    disposition: r.disposition, evaluable: r.evaluable, finalized: r.finalizedAt !== null,
    outcome: r.after.groundTruth?.outcome ?? null,
    advanced: r.after.groundTruth?.advanced ?? r.after.aiOutcome.advanced,
    aiStage: `${r.after.aiOutcome.stageBeforeId}→${r.after.aiOutcome.stageAfterId}`,
  };
}

export async function previewApi(path: string, method: string, payload?: unknown): Promise<unknown> {
  const body = (payload ?? {}) as Record<string, any>;
  if (path === '/api/health') return {
    ready: true, aiPath: 'deterministic', checks: [{ id: 'test-preview', level: 'warn',
      title: 'Browser test preview', detail: 'Sample calls only. No Claude, shared persistence, or CRM sync. Active calls reset on refresh; finalized samples stay in this tab.' }],
  };
  if (path === '/api/schemas') return { schemas: listSchemas().map(s => ({
    key: s.key, label: s.label, conversionEventNoun: s.terminology.conversionEventNoun,
    stages: s.ladder.stages.map(st => ({ id: st.id, label: st.label, order: st.order, meaningful: st.meaningfulConversion })),
  })) };
  if (path === '/api/session' && method === 'POST') {
    const industry = body.industry ?? 'funding';
    const context = buildContext(body, industry);
    const sessionId = 'preview_' + crypto.randomUUID();
    const engine = await composeCopilot({ callId: sessionId, industry, context, llm: null });
    live.set(sessionId, { ...engine, sessionId, prospectId: context.prospect.id,
      repId: body.repId || 'rep_preview', industry, context, createdAt: new Date().toISOString(), turnIndex: 0 });
    return { sessionId, briefing: engine.copilot.context.briefing, aiPath: 'deterministic' };
  }
  if ((path === '/api/dashboard' || path === '/api/sessions') && method === 'GET') {
    const saved = records();
    return { metrics: buildDashboard(saved), records: saved.map(summarize), count: saved.length };
  }
  const savedMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (savedMatch) {
    const saved = records();
    const record = saved.find(r => r.sessionId === savedMatch[1]);
    if (!record) throw new Error('Sample record not found');
    if (method === 'GET') return { record, summary: summarize(record) };
    if (method === 'DELETE') {
      sessionStorage.setItem(KEY, JSON.stringify(saved.filter(r => r.sessionId !== record.sessionId)));
      return { deleted: true, sessionId: record.sessionId };
    }
    if (method === 'PATCH') {
      if (!('groundTruth' in body)) throw new Error('Include groundTruth to update the sample');
      if (body.groundTruth !== null && (!body.groundTruth?.outcome || !body.groundTruth?.disposition)) {
        throw new Error('Select outcome and disposition before saving.');
      }
      const updated = applyGroundTruthToRecord(record, body.groundTruth);
      sessionStorage.setItem(KEY, JSON.stringify(saved.map(r => r.sessionId === updated.sessionId ? updated : r)));
      return { updated: true, record: updated, summary: summarize(updated) };
    }
    throw new Error('Unsupported preview method');
  }
  const abandon = path.match(/^\/api\/session\/([^/]+)$/);
  if (abandon && method === 'DELETE') return inSession(abandon[1]!, async () => {
    if (!live.delete(abandon[1]!)) throw new Error('Live sample not found');
    return { deleted: true, sessionId: abandon[1] };
  });
  const match = path.match(/^\/api\/session\/([^/]+)\/(ingest|state|feedback|finalize)$/);
  if (!match) throw new Error('Unknown preview action');
  const action = match[2];
  if (method !== (action === 'state' ? 'GET' : 'POST')) throw new Error('Unsupported preview method');
  return inSession(match[1]!, async () => {
    const s = live.get(match[1]!);
    if (!s) throw new Error('This test session ended or the page refreshed. Start a new session.');
    if (action === 'state') return { state: s.copilot.currentState(), transcript: s.copilot.getTranscript() };
    if (action === 'ingest') {
      let turns: Turn[];
      if (typeof body.transcript === 'string') {
        turns = parseTranscript(body.transcript).map(t => ({ ...t, index: s.turnIndex++ }));
      } else {
        const previous = [...s.copilot.getTranscript()].reverse().find(t => t.speaker !== 'system');
        const speaker = body.speaker === 'rep' || body.speaker === 'prospect' ? body.speaker :
          classifyLiveUtterance(String(body.text ?? ''), previous ? previous.speaker as 'rep' | 'prospect' : null).role;
        turns = [{ index: s.turnIndex++, speaker, text: String(body.text ?? '') }];
      }
      let update = null;
      let ingested = 0;
      for (const turn of turns) if (turn.text.trim()) { update = await s.copilot.ingest(turn); ingested++; }
      return { update, state: s.copilot.currentState(), recommendations: update?.recommendations ?? [], ingested, turns };
    }
    if (action === 'feedback') {
      s.copilot.recordFeedback(body.recommendationId, body.feedback, s.turnIndex);
      return { ok: true };
    }
    if (action === 'finalize') {
      if (!body.groundTruth?.outcome || !body.groundTruth?.disposition) throw new Error('Select outcome and disposition before saving.');
      const report = buildReport(s.copilot, s.exec, getSchema(s.industry));
      const record = assembleSessionRecord({ ...s, report, groundTruth: body.groundTruth ?? null });
      record.synthetic = true;
      // Complete the write before discarding the active session; quota failures remain retryable.
      sessionStorage.setItem(KEY, JSON.stringify([...records(), record]));
      live.delete(s.sessionId);
      return { saved: true, sessionId: s.sessionId, kind: record.kind, evaluable: record.evaluable,
        score: scoreRecord(record), outcome: record.after.aiOutcome };
    }
    throw new Error('Unknown preview action');
  });
}
