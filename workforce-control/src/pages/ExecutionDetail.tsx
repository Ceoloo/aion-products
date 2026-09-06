import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { useTenant } from '@/hooks/useTenant';
import { RuntimeApi } from '@/lib/runtime-api';
import type { ExecutionObject } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

/**
 * Execution Detail — full canonical Execution Object fields from API.
 */
export default function ExecutionDetail() {
  const { executionId = '' } = useParams();
  const { tenantId } = useTenant();
  const [execution, setExecution] = useState<ExecutionObject | null>(null);
  const [tree, setTree] = useState<ExecutionObject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setExecution(null);
        setTree([]);
        setError(err instanceof Error ? err.message : 'Failed to load execution');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, executionId]);

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
        ['domain', execution.domain ?? '—'],
        ['tenantId', execution.tenantId ?? '—'],
        ['riskLevel', execution.riskLevel ?? '—'],
        ['autonomyLevel', execution.autonomyLevel ?? '—'],
        ['approvalId', execution.approvalId ?? '—'],
        ['runId', execution.runId ?? '—'],
        ['requestId', execution.requestId ?? '—'],
        ['commandId', execution.commandId ?? '—'],
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
    <Shell>
      <div className="mb-6 text-sm flex gap-3">
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          ← Holding
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

      {loading && (
        <p className="text-sm text-muted-foreground animate-pulse-soft">Loading execution…</p>
      )}
      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {execution && (
        <>
          <header className="mb-8 animate-fade-up">
            <p className="text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
              Execution object
            </p>
            <h1 className="mt-1 font-display text-2xl md:text-3xl font-semibold tracking-tight font-mono break-all">
              {execution.executionId}
            </h1>
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
    </Shell>
  );
}
