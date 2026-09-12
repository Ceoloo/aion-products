import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { useTenant } from '@/hooks/useTenant';
import { RuntimeApi } from '@/lib/runtime-api';
import type { ApprovalRequest, ExecutionObject, OutcomeRecord } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { ApprovalPanel } from '@/components/ApprovalPanel';
import { ErrorState, LoadState } from '@/components/WorkflowState';

/**
 * Execution Detail — full canonical Execution Object fields from API.
 */
export default function ExecutionDetail() {
  const { executionId = '' } = useParams();
  const { tenantId } = useTenant();
  const [execution, setExecution] = useState<ExecutionObject | null>(null);
  const [tree, setTree] = useState<ExecutionObject[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!executionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    RuntimeApi.getExecution(tenantId, executionId)
      .then(async (body) => {
        if (cancelled) return;
        const exe = body.execution ?? null;
        setExecution(exe);
        if (exe?.rootExecutionId || exe?.executionId) {
          try {
            const root = await RuntimeApi.getExecutionsByRoot(
              tenantId,
              exe.rootExecutionId ?? exe.executionId,
            );
            if (!cancelled) setTree(root.executions ?? []);
          } catch {
            if (!cancelled) setTree([]);
          }
        }
        if (exe?.runId) {
          try {
            const out = await RuntimeApi.listOutcomes(tenantId, { runId: exe.runId });
            if (!cancelled) setOutcomes(out.outcomes ?? []);
          } catch {
            if (!cancelled) setOutcomes([]);
          }
        } else if (!cancelled) {
          setOutcomes([]);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setExecution(null);
        setTree([]);
        setOutcomes([]);
        setError(err instanceof Error ? err.message : 'Failed to load execution');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, executionId, tick]);

  useEffect(() => {
    if (!executionId) return;
    let cancelled = false;
    RuntimeApi.listApprovals(tenantId, 'pending')
      .then((body) => {
        if (cancelled) return;
        setApprovals(
          (body.approvals ?? []).filter(
            (a) => a.executionId === executionId || a.missionId === execution?.missionId,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setApprovals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, executionId, execution?.missionId, tick]);

  const rows: Array<[string, ReactNode]> = execution
    ? [
        [
          'status',
          <Badge
            key="s"
            variant={
              execution.status === 'succeeded'
                ? 'ok'
                : execution.status === 'denied' || execution.status === 'failed'
                  ? 'destructive'
                  : 'secondary'
            }
          >
            {execution.status}
          </Badge>,
        ],
        ['cost', execution.cost?.units != null ? `${execution.cost.units} units` : '—'],
        ['agentUri', execution.agentUri ?? '—'],
        ['actorId', execution.actorId ?? '—'],
        ['domain', execution.domain ?? '—'],
        ['tenantId', execution.tenantId ?? '—'],
        ['companyId', execution.companyId ?? '—'],
        ['ventureId', execution.ventureId ?? '—'],
        ['projectId', execution.projectId ?? '—'],
        ['riskLevel', execution.riskLevel ?? '—'],
        ['autonomyLevel', execution.autonomyLevel ?? '—'],
        ['approvalId', execution.approvalId ?? '—'],
        ['runId', execution.runId ?? '—'],
        ['requestId', execution.requestId ?? '—'],
        ['commandId', execution.commandId ?? '—'],
        [
          'serviceKey',
          typeof execution.metadata?.serviceKey === 'string'
            ? execution.metadata.serviceKey
            : typeof execution.metadata?.catalogServiceKey === 'string'
              ? execution.metadata.catalogServiceKey
              : '—',
        ],
        [
          'missionId',
          execution.missionId ? (
            <Link className="text-primary hover:underline" to={`/missions/${execution.missionId}`}>
              {execution.missionId}
            </Link>
          ) : (
            '—'
          ),
        ],
        ['workflowId', execution.workflowId ?? '—'],
        [
          'parentExecutionId',
          execution.parentExecutionId ? (
            <Link
              className="text-primary hover:underline"
              to={`/executions/${execution.parentExecutionId}`}
            >
              {execution.parentExecutionId}
            </Link>
          ) : (
            '—'
          ),
        ],
        [
          'rootExecutionId',
          execution.rootExecutionId ? (
            <Link
              className="text-primary hover:underline"
              to={`/executions/${execution.rootExecutionId}`}
            >
              {execution.rootExecutionId}
            </Link>
          ) : (
            '—'
          ),
        ],
        ['revenueAttributed', execution.revenueAttributed ?? '—'],
        ['outcomeSummary', execution.outcomeSummary ?? '—'],
        ['startedAt', execution.startedAt ?? '—'],
        ['completedAt', execution.completedAt ?? '—'],
        ['createdAt', execution.createdAt ?? '—'],
      ]
    : [];

  return (
    <Shell
      onOpenApprovals={() => setPanelOpen(true)}
      pendingCount={approvals.length}
    >
      <div className="mb-6 text-sm flex gap-3">
        <Link to="/missions" className="text-muted-foreground hover:text-foreground">
          ← Mission Control
        </Link>
        {execution?.missionId && (
          <Link
            to={`/missions/${execution.missionId}`}
            className="text-muted-foreground hover:text-foreground"
          >
            Mission
          </Link>
        )}
      </div>

      {loading && <LoadState label="Loading execution…" />}
      {error && (
        <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} className="mb-4" />
      )}

      {execution && (
        <>
          <header className="mb-8 animate-fade-up">
            <p className="text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
              Execution object
            </p>
            <h1 className="mt-1 font-display text-2xl md:text-3xl font-semibold tracking-tight font-mono break-all">
              {execution.executionId}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              {(execution.outcomeSummary ||
                execution.revenueAttributed != null ||
                execution.outcomeId) && (
                <Badge variant="ok">
                  {execution.outcomeId
                    ? `outcome ${execution.outcomeId}`
                    : execution.outcomeSummary
                      ? String(execution.outcomeSummary)
                      : `revenue ${execution.revenueAttributed}`}
                </Badge>
              )}
              {outcomes.length > 0 && (
                <Badge variant="outline">{outcomes.length} durable outcome(s)</Badge>
              )}
            </div>
          </header>

          <section className="mb-10 animate-fade-up" style={{ animationDelay: '80ms' }}>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 rounded-md border border-border/70 bg-card/40 p-4">
              {rows.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                    {k}
                  </dt>
                  <dd className="mt-0.5 text-sm font-mono break-all text-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mb-10 animate-fade-up" style={{ animationDelay: '110ms' }}>
            <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
              Business outcomes
            </h2>
            {outcomes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No durable outcomes linked to this execution&apos;s run.
              </p>
            ) : (
              <ul className="divide-y divide-border/70 border border-border/70 rounded-md">
                {outcomes.map((o) => (
                  <li key={o.outcomeId} className="px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{o.outcomeId}</span>
                      <Badge variant="secondary">{o.status}</Badge>
                      {o.outcomeType && <Badge variant="outline">{o.outcomeType}</Badge>}
                    </div>
                    <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">
                      {o.measuredAt ?? o.createdAt ?? '—'}
                      {o.value != null && (
                        <span>
                          {' · '}
                          {o.value}
                          {o.currency ? ` ${o.currency}` : ''}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="animate-fade-up" style={{ animationDelay: '140ms' }}>
            <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
              Root tree
            </h2>
            {tree.length === 0 ? (
              <p className="text-sm text-muted-foreground">No by-root lineage returned.</p>
            ) : (
              <ol className="space-y-2 border border-border/70 rounded-md p-3">
                {tree.map((e) => (
                  <li key={e.executionId} className="text-sm flex justify-between gap-2">
                    <Link
                      to={`/executions/${e.executionId}`}
                      className={`font-mono text-xs hover:underline ${
                        e.executionId === execution.executionId
                          ? 'text-primary'
                          : 'text-foreground'
                      }`}
                    >
                      {e.executionId}
                    </Link>
                    <span className="text-xs text-muted-foreground">{e.status}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
      <ApprovalPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        approvals={approvals}
        loading={loading}
        error={error}
        tenantId={tenantId}
        onDecided={() => setTick((t) => t + 1)}
      />
    </Shell>
  );
}

