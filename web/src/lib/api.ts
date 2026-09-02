// Thin client for the AION console API. Same-origin in production; the token
// (if the server requires one) is read from the page URL and forwarded.

const TOKEN = new URLSearchParams(location.search).get('token') || '';

/** Same-origin JSON fetch helper: forwards the LAN token and throws on non-2xx. */
async function api<T = any>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  if (TOKEN) headers['x-aion-token'] = TOKEN;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Shapes (a subset of the server/domain types the UI reads) ──────────────
export type Speaker = 'rep' | 'prospect' | 'system';
export interface Turn { index: number; speaker: Speaker; text: string }
export interface FactSlot { key: string; label: string; value: string | null; confidence: number; statedExplicitly: boolean }
export interface ReadinessSignal { key: string; label: string; state: 'confirmed' | 'partial' | 'missing' | 'blocked'; detail?: string }
export interface Objection { id: string; surface: string; category: string; status: 'open' | 'addressed' | 'resolved'; underlyingConcerns: string[] }
export interface Gap { id: string; kind: string; message: string; severity: 'info' | 'warn' | 'block' }
export interface Recommendation { id: string; type: string; title: string; rationale: string; suggestedUtterance?: string; priority: number }
export interface DealState {
  conversationStage: string;
  sentiment: string;
  urgency: string;
  position: { startOrder: number; currentOrder: number; highWaterOrder: number };
  facts: Record<string, FactSlot | undefined>;
  readiness: { level: string; score: number; primaryBlocker: string | null; signals: ReadinessSignal[] };
  objections: Objection[];
  buyingSignals: { id: string; kind: string; surface: string }[];
  gaps: Gap[];
  missingInformation: string[];
}
export interface SchemaStage { id: string; label: string; order: number; meaningful: boolean }
export interface SchemaInfo { key: string; label: string; conversionEventNoun: string; stages: SchemaStage[] }

export interface IngestResult { state: DealState; recommendations: Recommendation[]; ingested: number; turns?: Turn[] }
export interface GateStatus { value: number; target: number; met: boolean }
export interface DashboardMetrics {
  totalSessions: number; totalDials: number; evaluableConversations: number;
  realCalls: GateStatus; factAccuracy: number | null; objectionAccuracy: number | null;
  usefulInterventionRate: number | null; conversionAdvances: GateStatus; downstreamConversions: GateStatus;
  lineageCompleteness: number | null; dispositions: Record<string, number>; gatesMet: boolean;
}
export interface DashboardRecord {
  sessionId: string; createdAt: string; prospect: string; industry: string; kind: string;
  disposition: string; evaluable: boolean; finalized: boolean; outcome: string | null; advanced: boolean; aiStage: string;
}

export const AionApi = {
  schemas: () => api<{ schemas: SchemaInfo[] }>('/api/schemas'),
  createSession: (body: Record<string, unknown>) => api<{ sessionId: string; briefing: string; aiPath: string }>('/api/session', 'POST', body),
  ingestText: (id: string, text: string, speaker?: 'rep' | 'prospect' | 'auto') => api<IngestResult>(`/api/session/${id}/ingest`, 'POST', { text, speaker }),
  ingestTranscript: (id: string, transcript: string) => api<IngestResult>(`/api/session/${id}/ingest`, 'POST', { transcript }),
  state: (id: string) => api<{ state: DealState; transcript: Turn[] }>(`/api/session/${id}/state`),
  feedback: (id: string, recommendationId: string, feedback: string) => api(`/api/session/${id}/feedback`, 'POST', { recommendationId, feedback }),
  finalize: (id: string, groundTruth: unknown) => api<{ saved: boolean; sessionId: string; kind: string; evaluable: boolean }>(`/api/session/${id}/finalize`, 'POST', { groundTruth }),
  dashboard: () => api<{ metrics: DashboardMetrics; records: DashboardRecord[] }>('/api/dashboard'),
};
