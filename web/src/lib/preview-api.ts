/** Isolated browser test adapter. Uses the actual product/Core engine, never a model key.
 * No network persistence: finalized sample records are scoped to this browser tab.
 * The normal server API remains the default outside Vite's explicit preview mode.
 */
import { createCopilot, buildReport, getSchema, listSchemas } from '../../../src/aion.ts';
import { parseTranscript } from '../../../src/validation/transcript.ts';
import { classifyLiveUtterance } from '../../../src/validation/speaker-roles.ts';
import { assembleSessionRecord } from '../../../src/validation/record.ts';
import { buildDashboard, scoreRecord } from '../../../src/validation/scoring.ts';
import type { SessionRecord } from '../../../src/domain/session.ts';
import type { Turn } from '../../../src/domain/types.ts';
import { buildContext } from './preview-context';

const KEY = 'aion-preview-test-records-v1';
type Session = Awaited<ReturnType<typeof createCopilot>> & {
  sessionId: string; prospectId: string; repId: string; industry: string;
  createdAt: string; context: ReturnType<typeof buildContext>; turnIndex: number;
};
const live = new Map<string, Session>();
function records(): SessionRecord[] {
  const data = sessionStorage.getItem(KEY);
  if (!data) return [];
  const parsed = JSON.parse(data);
  if (!Array.isArray(parsed)) throw new Error('Invalid preview records. Clear this tab’s session storage to reset.');
  return parsed;
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
    const engine = await createCopilot({ callId: sessionId, industry, context, llm: null });
    live.set(sessionId, { ...engine, sessionId, prospectId: context.prospect.id,
      repId: body.repId || 'rep_preview', industry, context, createdAt: new Date().toISOString(), turnIndex: 0 });
    return { sessionId, briefing: engine.copilot.context.briefing, aiPath: 'deterministic' };
  }
  if (path === '/api/dashboard') {
    const saved = records();
    return { metrics: buildDashboard(saved), records: saved.map(r => ({
      sessionId: r.sessionId, createdAt: r.createdAt, prospect: r.before.context.prospect.name,
      industry: r.industry, kind: r.kind, disposition: r.disposition, evaluable: r.evaluable,
      finalized: r.finalizedAt !== null, outcome: r.after.groundTruth?.outcome ?? null,
      advanced: r.after.groundTruth?.advanced ?? r.after.aiOutcome.advanced,
      aiStage: `${r.after.aiOutcome.stageBeforeId}→${r.after.aiOutcome.stageAfterId}`,
    })) };
  }
  const match = path.match(/^\/api\/session\/([^/]+)\/(ingest|state|feedback|finalize)$/);
  if (!match) throw new Error('Unknown preview action');
  const s = live.get(match[1]);
  if (!s) throw new Error('This test session ended or the page refreshed. Start a new session.');
  const action = match[2];
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
    const report = buildReport(s.copilot, s.exec, getSchema(s.industry));
    const record = assembleSessionRecord({ ...s, report, groundTruth: body.groundTruth ?? null });
    // Complete the write before discarding the active session; quota failures remain retryable.
    sessionStorage.setItem(KEY, JSON.stringify([...records(), record]));
    live.delete(s.sessionId);
    return { saved: true, sessionId: s.sessionId, kind: record.kind, evaluable: record.evaluable,
      score: scoreRecord(record), outcome: record.after.aiOutcome };
  }
  throw new Error('Unknown preview action');
}
