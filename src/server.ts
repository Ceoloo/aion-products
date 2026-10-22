/**
 * Revenue Copilot HTTP service — MISSION-001 entrypoint shape #2.
 *
 * Exposes the existing LiveCopilot turn-stream loop over HTTP so a caller can
 * POST turns and receive guidance. Does not invent telephony, websockets, or
 * continuous stream ingestion (shape #3). CLI/job (shape #1) remains available.
 *
 * Deployment contract (aion-infra):
 *   GET  /health/live
 *   GET  /health/ready
 *   GET  /                 — release identity
 *   structured JSON logs, SIGTERM drain
 *
 * Product surface (thin wrapper over createCopilot / ingest / buildReport):
 *   POST   /v1/sessions
 *   GET    /v1/sessions
 *   GET    /v1/sessions/:id
 *   DELETE /v1/sessions/:id
 *   POST   /v1/sessions/:id/turns
 *   POST   /v1/sessions/:id/feedback
 *   POST   /v1/sessions/:id/finish
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  createCopilot,
  buildReport,
  detectProvider,
  getSchema,
  type LiveCopilot,
  type AiExecutionService,
} from './aion.ts';
import type { ContextInput } from './engines/context.ts';
import type { Turn } from './domain/types.ts';
import type { RepFeedback } from './domain/recommendation.ts';
import {
  buildCallOutcomeAttribution,
  publishCallOutcome,
} from './platform/outcome.ts';
import {
  RuntimeClient,
  resolveRuntimeUrl,
  runtimeClientOptionsFromEnv,
} from './platform/runtime-client.ts';
import { createSessionStore } from './validation/runtime-session-store.ts';
import type { SessionStore } from './validation/store.ts';
import { assembleSessionRecord } from './validation/record.ts';
import {
  assertCallerTenantAccess,
  authenticateCopilotRequest,
  callerTenantFromRequest,
  loadCopilotAuthConfig,
  type CopilotAuthConfig,
  type CopilotCaller,
  CopilotAuthConfigError,
} from './server/inbound-auth.ts';
import {
  BodyTooLargeError,
  DEFAULT_MAX_BODY_BYTES,
  readBodyLimited,
} from './server/read-body.ts';

const SERVICE = 'aion-revenue-copilot';
const PORT = Number(process.env.PORT ?? 8080);
const ENVIRONMENT = process.env.AION_ENVIRONMENT ?? 'local';
const GIT_SHA = process.env.GIT_SHA ?? 'dev';
const SERVICE_VERSION = process.env.SERVICE_VERSION ?? '0.1.0';
const BUILD_TIME = process.env.BUILD_TIME ?? new Date().toISOString();
const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info') as
  | 'debug'
  | 'info'
  | 'warn'
  | 'error';
const SESSION_TTL_MS = Number(process.env.COPILOT_SESSION_TTL_MS ?? 60 * 60 * 1000);
const MAX_BODY_BYTES = Number(
  process.env.COPILOT_MAX_BODY_BYTES ?? DEFAULT_MAX_BODY_BYTES,
);
// ADR-007: staging/production fail-closed unless packaging escape hatch is set.
const RUNTIME_URL = resolveRuntimeUrl();
const runtimeClient = RUNTIME_URL
  ? new RuntimeClient(runtimeClientOptionsFromEnv(RUNTIME_URL))
  : null;
/** Durable session checkpoints when Runtime is configured; else in-memory only. */
const durableStore: SessionStore | null = RUNTIME_URL
  ? createSessionStore({ runtimeUrl: RUNTIME_URL })
  : null;

let authConfig: CopilotAuthConfig;
try {
  authConfig = loadCopilotAuthConfig(process.env);
} catch (err) {
  const message =
    err instanceof CopilotAuthConfigError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: SERVICE,
      environment: ENVIRONMENT,
      message: 'auth_config_invalid',
      error: message,
    })}\n`,
  );
  process.exit(1);
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

function log(
  level: keyof typeof LEVELS,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  if (LEVELS[level] < LEVELS[LOG_LEVEL]) return;
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: SERVICE,
      environment: ENVIRONMENT,
      git_sha: GIT_SHA,
      service_version: SERVICE_VERSION,
      message,
      ...fields,
    })}\n`,
  );
}

interface Session {
  id: string;
  callId: string;
  industry: string;
  context: ContextInput;
  copilot: LiveCopilot;
  exec: AiExecutionService;
  createdAt: number;
  lastAccessAt: number;
  finished: boolean;
  /** Authenticated owner; null only when auth mode is open (local). */
  ownerId: string | null;
  tenantId: string | null;
}

const sessions = new Map<string, Session>();
let accepting = true;

function pruneSessions(now = Date.now()): void {
  for (const [id, s] of sessions) {
    if (now - s.lastAccessAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return readBodyLimited(req, MAX_BODY_BYTES);
}

/** Session is visible/mutable only to its owner (or anyone in open/local mode). */
function sessionOwnedBy(
  session: Session,
  caller: CopilotCaller | null,
): boolean {
  if (session.ownerId === null) return true;
  if (!caller) return false;
  return session.ownerId === caller.callerId && session.tenantId === caller.tenantId;
}

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function providerName(): string {
  return detectProvider()?.name ?? 'deterministic';
}

function isContextInput(value: unknown): value is ContextInput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.prospect === 'object' &&
    v.prospect !== null &&
    typeof v.company === 'object' &&
    v.company !== null &&
    typeof v.offer === 'object' &&
    v.offer !== null &&
    typeof v.conversionStageId === 'string' &&
    typeof v.desiredNextStageId === 'string'
  );
}

function parseTurn(raw: unknown): Turn | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.index !== 'number' || !Number.isFinite(t.index)) return null;
  if (t.speaker !== 'rep' && t.speaker !== 'prospect' && t.speaker !== 'system') {
    return null;
  }
  if (typeof t.text !== 'string' || t.text.trim().length === 0) return null;
  const turn: Turn = {
    index: t.index,
    speaker: t.speaker,
    text: t.text,
  };
  if (typeof t.atMs === 'number') turn.atMs = t.atMs;
  return turn;
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const started = Date.now();
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  const done = (status: number, body: unknown): void => {
    send(res, status, body);
    log('info', 'http_request', {
      operation: `${method} ${path}`,
      status: String(status),
      latency_ms: Date.now() - started,
    });
  };

  try {
    if (method === 'GET' && path === '/health/live') {
      done(200, { status: 'ok' });
      return;
    }

    if (method === 'GET' && path === '/health/ready') {
      // Copilot has no database dependency. Ready while accepting traffic;
      // deterministic path is a valid ready state (no key required).
      if (!accepting) {
        done(503, { status: 'draining' });
        return;
      }
      done(200, {
        status: 'ready',
        provider: providerName(),
        sessions: sessions.size,
      });
      return;
    }

    if (method === 'GET' && path === '/') {
      done(200, {
        service: SERVICE,
        environment: ENVIRONMENT,
        git_sha: GIT_SHA,
        service_version: SERVICE_VERSION,
        build_time: BUILD_TIME,
        entrypoint: 'http-turn-stream',
        provider: providerName(),
        auth_mode: authConfig.mode,
      });
      return;
    }

    // All /v1/* routes require inbound auth (AIO-39) when mode=required.
    const auth = authenticateCopilotRequest(req, authConfig);
    if (!auth.ok) {
      done(auth.status, { error: auth.error, message: auth.message });
      return;
    }
    const caller = auth.caller;
    const tenantDenied = assertCallerTenantAccess(
      caller,
      callerTenantFromRequest(req),
    );
    if (tenantDenied) {
      done(tenantDenied.status, {
        error: tenantDenied.error,
        message: tenantDenied.message,
      });
      return;
    }

    if (method === 'POST' && path === '/v1/sessions') {
      if (!accepting) {
        done(503, { error: 'draining', message: 'server is shutting down' });
        return;
      }
      const raw = await readBody(req);
      let body: Record<string, unknown>;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        done(400, { error: 'invalid_json', message: 'body must be JSON' });
        return;
      }

      const industry = typeof body.industry === 'string' ? body.industry : '';
      let schemaOk = false;
      try {
        if (industry) {
          getSchema(industry);
          schemaOk = true;
        }
      } catch {
        schemaOk = false;
      }
      if (!schemaOk) {
        done(400, {
          error: 'invalid_industry',
          message: 'industry must be a registered SalesSchema id',
        });
        return;
      }
      if (!isContextInput(body.context)) {
        done(400, {
          error: 'invalid_context',
          message:
            'context requires prospect, company, offer, conversionStageId, desiredNextStageId',
        });
        return;
      }

      const context: ContextInput = {
        prospect: body.context.prospect,
        company: body.context.company,
        offer: body.context.offer,
        crmState: body.context.crmState ?? {},
        priorConversations: body.context.priorConversations ?? [],
        priorObjections: body.context.priorObjections ?? [],
        outstandingQuestions: body.context.outstandingQuestions ?? [],
        knownFacts: body.context.knownFacts ?? {},
        conversionStageId: body.context.conversionStageId,
        desiredNextStageId: body.context.desiredNextStageId,
      };

      const callId =
        typeof body.callId === 'string' && body.callId.trim()
          ? body.callId.trim()
          : `call_${randomUUID()}`;
      const sessionId = `sess_${randomUUID()}`;

      const { copilot, exec } = await createCopilot({
        callId,
        industry,
        context,
      });

      pruneSessions();
      const now = Date.now();
      sessions.set(sessionId, {
        id: sessionId,
        callId,
        industry,
        context,
        copilot,
        exec,
        createdAt: now,
        lastAccessAt: now,
        finished: false,
        ownerId: caller?.callerId ?? null,
        tenantId: caller?.tenantId ?? null,
      });

      done(201, {
        sessionId,
        callId,
        industry,
        provider: providerName(),
        briefing: copilot.context.briefing,
        ...(caller
          ? { callerId: caller.callerId, tenantId: caller.tenantId }
          : {}),
      });
      return;
    }

    if (method === 'GET' && path === '/v1/sessions') {
      pruneSessions();
      const owned = [...sessions.values()].filter((s) =>
        sessionOwnedBy(s, caller),
      );
      const items = owned.map((s) => ({
        sessionId: s.id,
        callId: s.callId,
        industry: s.industry,
        createdAt: new Date(s.createdAt).toISOString(),
        lastAccessAt: new Date(s.lastAccessAt).toISOString(),
        finished: s.finished,
        turnCount: s.copilot.getTranscript().length,
      }));
      done(200, { sessions: items, count: items.length });
      return;
    }

    const sessionIdMatch = path.match(/^\/v1\/sessions\/([^/]+)$/);
    if (sessionIdMatch && (method === 'GET' || method === 'DELETE')) {
      const sessionId = decodeURIComponent(sessionIdMatch[1]!);
      const session = sessions.get(sessionId);
      if (!session || !sessionOwnedBy(session, caller)) {
        // Do not leak existence of another caller's session.
        done(404, { error: 'session_not_found' });
        return;
      }
      if (method === 'DELETE') {
        sessions.delete(sessionId);
        done(200, { deleted: true, sessionId });
        return;
      }
      session.lastAccessAt = Date.now();
      done(200, {
        sessionId: session.id,
        callId: session.callId,
        industry: session.industry,
        createdAt: new Date(session.createdAt).toISOString(),
        lastAccessAt: new Date(session.lastAccessAt).toISOString(),
        finished: session.finished,
        state: session.copilot.currentState(),
        transcript: session.copilot.getTranscript(),
        recommendations: session.copilot.getSurfaced(),
      });
      return;
    }

    const turnMatch = path.match(/^\/v1\/sessions\/([^/]+)\/turns$/);
    if (method === 'POST' && turnMatch) {
      const session = sessions.get(decodeURIComponent(turnMatch[1]!));
      if (!session || !sessionOwnedBy(session, caller)) {
        done(404, { error: 'session_not_found' });
        return;
      }
      if (session.finished) {
        done(409, { error: 'session_finished' });
        return;
      }
      const raw = await readBody(req);
      let body: Record<string, unknown>;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        done(400, { error: 'invalid_json' });
        return;
      }
      const turn = parseTurn(body.turn ?? body);
      if (!turn) {
        done(400, {
          error: 'invalid_turn',
          message: 'turn requires index, speaker (rep|prospect|system), text',
        });
        return;
      }

      session.lastAccessAt = Date.now();
      const update = await session.copilot.ingest(turn);
      done(200, {
        sessionId: session.id,
        callId: session.callId,
        turnIndex: update.turnIndex,
        state: update.state,
        recommendations: update.recommendations,
        gaps: update.gaps,
      });
      return;
    }

    const feedbackMatch = path.match(/^\/v1\/sessions\/([^/]+)\/feedback$/);
    if (method === 'POST' && feedbackMatch) {
      const session = sessions.get(decodeURIComponent(feedbackMatch[1]!));
      if (!session || !sessionOwnedBy(session, caller)) {
        done(404, { error: 'session_not_found' });
        return;
      }
      const raw = await readBody(req);
      let body: Record<string, unknown>;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        done(400, { error: 'invalid_json' });
        return;
      }
      const recommendationId = String(body.recommendationId ?? '');
      const feedback = body.feedback as RepFeedback;
      const atTurn = Number(body.atTurn);
      const allowed: readonly RepFeedback[] = [
        'useful',
        'ignored',
        'wrong',
        'already_knew',
        'acted_on',
      ];
      if (
        !recommendationId ||
        !Number.isFinite(atTurn) ||
        !allowed.includes(feedback)
      ) {
        done(400, {
          error: 'invalid_feedback',
          message:
            'recommendationId, atTurn, and feedback (useful|ignored|wrong|already_knew|acted_on) required',
        });
        return;
      }
      session.lastAccessAt = Date.now();
      session.copilot.recordFeedback(
        recommendationId,
        feedback,
        atTurn,
        typeof body.note === 'string' ? body.note : undefined,
      );
      done(200, { sessionId: session.id, recorded: true });
      return;
    }

    const finishMatch = path.match(/^\/v1\/sessions\/([^/]+)\/finish$/);
    if (method === 'POST' && finishMatch) {
      const session = sessions.get(decodeURIComponent(finishMatch[1]!));
      if (!session || !sessionOwnedBy(session, caller)) {
        done(404, { error: 'session_not_found' });
        return;
      }
      session.lastAccessAt = Date.now();
      session.finished = true;
      const schema = getSchema(session.industry);
      const report = buildReport(session.copilot, session.exec, schema);

      let businessOutcome: { outcomeId?: string; skipped?: string } | null = null;
      const ids = session.exec.attributionIds();
      if (runtimeClient && ids.runIds.length > 0) {
        const attribution = buildCallOutcomeAttribution({
          callId: session.callId,
          runIds: ids.runIds,
          executionIds: ids.executionIds,
          totalCostUnits: ids.totalCostUnits,
          ...(ids.totalTokens !== undefined ? { totalTokens: ids.totalTokens } : {}),
          advanced: report.outcome.advanced,
          stageBeforeId: report.outcome.stageBeforeId,
          stageAfterId: report.outcome.stageAfterId,
        });
        try {
          const outcome = await publishCallOutcome(runtimeClient, attribution);
          businessOutcome = outcome
            ? { outcomeId: outcome.outcomeId }
            : { skipped: 'no_run_ids' };
        } catch (e) {
          log('warn', 'outcome_publish_failed', {
            callId: session.callId,
            error: e instanceof Error ? e.message : String(e),
          });
          businessOutcome = { skipped: 'publish_failed' };
        }
      } else if (!runtimeClient) {
        businessOutcome = { skipped: 'runtime_unset' };
      } else {
        businessOutcome = { skipped: 'no_run_ids' };
      }

      // Best-effort durable session final when Runtime session store is wired.
      if (durableStore) {
        try {
          const record = assembleSessionRecord({
            sessionId: session.id,
            prospectId: session.context.prospect.id,
            repId: 'api',
            industry: session.industry,
            createdAt: new Date(session.createdAt).toISOString(),
            context: session.context,
            copilot: session.copilot,
            report,
            groundTruth: null,
          });
          // Mark finished for Runtime final_record path even without rep GT.
          record.finalizedAt = new Date().toISOString();
          await durableStore.save(record);
        } catch (e) {
          log('warn', 'session_persist_failed', {
            sessionId: session.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      done(200, {
        sessionId: session.id,
        callId: session.callId,
        report,
        ...(businessOutcome ? { businessOutcome } : {}),
      });
      return;
    }

    done(404, { error: 'not_found', path });
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      done(413, {
        error: 'payload_too_large',
        message: err.message,
        maxBytes: err.maxBytes,
      });
      return;
    }
    log('error', 'http_error', {
      operation: `${method} ${path}`,
      error: err instanceof Error ? err.message : 'unknown',
    });
    send(res, 500, { error: 'internal_error' });
  }
}

/** Test helper: replace auth config after import (node:test isolation). */
export function setAuthConfigForTests(next: CopilotAuthConfig): void {
  authConfig = next;
}

export function createCopilotServer(): http.Server {
  return http.createServer((req, res) => {
    void handle(req, res);
  });
}

/** Programmatic start for tests / main. */
export async function startCopilotServer(
  port: number = PORT,
): Promise<http.Server> {
  const server = createCopilotServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });
  log('info', 'server_listening', {
    port,
    provider: providerName(),
    entrypoint: 'http-turn-stream',
  });
  return server;
}

async function main(): Promise<void> {
  const server = await startCopilotServer(PORT);

  const shutdown = (signal: string): void => {
    if (!accepting) return;
    accepting = false;
    log('info', 'shutdown_signal', { signal });
    server.close((err) => {
      if (err) {
        log('error', 'shutdown_error', { error: err.message });
        process.exit(1);
      }
      log('info', 'shutdown_complete');
      process.exit(0);
    });
    // Force-exit if drain hangs.
    setTimeout(() => process.exit(1), 25_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('/src/server.ts') ||
    process.argv[1].endsWith('\\src\\server.ts') ||
    process.argv[1].endsWith('/src/server.js'));

if (isMain) {
  main().catch((err) => {
    log('error', 'server_boot_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
