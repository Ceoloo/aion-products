import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { MetricLink } from '@/components/MetricLink';
import { useTenant } from '@/hooks/useTenant';
import { missionCohortLabel, isCompletedWithException } from '@/lib/cohort';
import { RuntimeApi } from '@/lib/runtime-api';
import type { EconomicsRollup, ExecutionObject, Mission, OutcomeRecord } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Mission Detail — economics + lineage from API only.
 * Inspect checklist: objective, workflow, executions, agent/tenant, I/O,
 * approvals, policy, cost, terminal outcome — all from Runtime records.
 */
export default function MissionDetail() {
  const { missionId = '' } = useParams();
  const { tenantId } = useTenant();
  const [mission, setMission] = useState<Mission | null>(null);
  const [economics, setEconomics] = useState<EconomicsRollup | null>(null);
  const [executions, setExecutions] = useState<ExecutionObject[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [waiverReason, setWaiverReason] = useState('GHL HTTP 422');

  useEffect(() => {
    if (!missionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      RuntimeApi.getMission(tenantId, missionId),
      RuntimeApi.getMissionEconomics(tenantId, missionId),
      RuntimeApi.listExecutions(tenantId, 200),
      RuntimeApi.listOutcomes(tenantId, { missionId }).catch(() => ({
        outcomes: [] as OutcomeRecord[],
        count: 0,
      })),
    ])
      .then(([m, e, list, out]) => {
        if (cancelled) return;
        setMission(m.mission ?? null);
        setEconomics(e.economics ?? null);
        setExecutions(
          (list.executions ?? []).filter((x) => x.missionId === missionId),
        );
        setOutcomes(out.outcomes ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMission(null);
        setEconomics(null);
        setExecutions([]);
        setOutcomes([]);
        setError(err instanceof Error ? err.message : 'Failed to load mission');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, missionId]);

  const failed = useMemo(
    () => executions.filter((e) => e.status === 'failed' || e.status === 'denied'),
    [executions],
  );
  const costContributors = useMemo(
    () =>
      [...executions]
        .filter((e) => (e.cost?.units ?? 0) > 0)
        .sort((a, b) => (b.cost?.units ?? 0) - (a.cost?.units ?? 0)),
    [executions],
  );

  const lineageRoots = useMemo(() => {
    const roots = new Map<string, ExecutionObject[]>();
    for (const e of executions) {
      const root = e.rootExecutionId ?? e.executionId;
      const arr = roots.get(root) ?? [];
      arr.push(e);
      roots.set(root, arr);
    }
    return [...roots.entries()];
  }, [executions]);

  const terminalOutcome = useMemo(() => {
    const raw = mission?.metadata?.terminalOutcome;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  }, [mission]);

  const displayStatus = mission
    ? isCompletedWithException(mission)
      ? 'completed_with_exception'
      : mission.status
    : null;

  async function reloadMission() {
    const m = await RuntimeApi.getMission(tenantId, missionId);
    setMission(m.mission ?? null);
  }

  async function closeMission(mode: 'completed' | 'completed_with_exception') {
    if (!mission) return;
    setClosing(true);
    setCloseError(null);
    try {
      const approvals = economics?.approvals ?? 0;
      const executionCount = economics?.totalExecutions ?? executions.length;
      const costUnits = economics?.totalCostUnits ?? 0;
      if (mode === 'completed') {
        await RuntimeApi.patchMission(tenantId, mission.missionId, {
          status: 'completed',
          metadata: {
            outcomeStatus: 'completed',
            terminalOutcome: {
              status: 'completed',
              approvals,
              executions: executionCount,
              executionCostUnits: costUnits,
              humanIntervention: 'recorded',
              closedAt: new Date().toISOString(),
              closedFrom: 'operator-console',
            },
          },
        });
      } else {
        const reason = waiverReason.trim() || 'GHL HTTP 422';
        await RuntimeApi.patchMission(tenantId, mission.missionId, {
          status: 'completed',
          metadata: {
            outcomeStatus: 'completed_with_exception',
            terminalOutcome: {
              status: 'completed_with_exception',
              approvals,
              executions: executionCount,
              executionCostUnits: costUnits,
              humanIntervention: 'recorded',
              waivedStep: 'crm.task.create',
              reason,
              steps: {
                opportunityProgression: 'PASS',
                crmNote: 'PASS',
                draftMessage: 'PASS',
                taskCreate: `WAIVED — ${reason}`,
              },
              workflowDefectFound: 'create-vs-update routing',
              workflowDefectFixed: true,
              externalIntegrationDefect: 'crm.task.create / GHL',
              closedAt: new Date().toISOString(),
              closedFrom: 'operator-console',
            },
          },
        });
      }
      await reloadMission();
    } catch (err: unknown) {
      setCloseError(err instanceof Error ? err.message : 'Failed to close mission');
    } finally {
      setClosing(false);
    }
  }
  return (
    <Shell>
      <div className="mb-6 text-sm">
        <Link to="/missions" className="text-muted-foreground hover:text-foreground">
          ← Mission Control
        </Link>
      </div>

      {loading && <p className="text-sm text-muted-foreground animate-pulse-soft">Loading mission…</p>}
      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {mission && (
        <header className="mb-8 animate-fade-up">
          <p className="text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">Mission</p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl font-semibold tracking-tight">
            {mission.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{displayStatus ?? mission.status}</Badge>
            {mission.riskLevel && <Badge variant="outline">{mission.riskLevel}</Badge>}
            {missionCohortLabel(mission) === 'PRE-OL' && (
              <Badge variant="outline">PRE-OL</Badge>
            )}
            {missionCohortLabel(mission) === 'OL-001' && (
              <Badge variant="outline">OL-001</Badge>
            )}
            <span className="font-mono text-xs text-muted-foreground">{mission.missionId}</span>
          </div>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{mission.objective}</p>
          {mission.metadata && (
            <dl className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">cohort</dt>
                <dd className="font-mono">{String(mission.metadata.cohort ?? '—')}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">productionEconomic</dt>
                <dd className="font-mono">
                  {String(mission.metadata.productionEconomic ?? '—')}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">workflow</dt>
                <dd className="font-mono truncate">
                  {String(mission.metadata.workflowTemplateId ?? '—')}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">owner</dt>
                <dd className="font-mono truncate">{mission.owner}</dd>
              </div>
            </dl>
          )}
        </header>
      )}

      {mission && mission.status === 'active' && !terminalOutcome && (
        <section className="mb-10 animate-fade-up" style={{ animationDelay: '20ms' }}>
          <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
            Close mission
          </h2>
          <p className="mb-3 text-xs text-muted-foreground max-w-2xl">
            After the single evidence-driven <span className="font-mono">crm.task.create</span> retry:
            close normally on success, or record a visible exception waiver on 422.
            Do not leave M001 active.
          </p>
          <div className="space-y-3 rounded-md border border-border/70 p-3 max-w-xl">
            <label className="block text-xs text-muted-foreground">
              Waiver reason (used only for completed_with_exception)
              <input
                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
                value={waiverReason}
                onChange={(e) => setWaiverReason(e.target.value)}
                placeholder="GHL HTTP 422 — exact body"
              />
            </label>
            {closeError && <p className="text-sm text-destructive">{closeError}</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={closing}
                onClick={() => void closeMission('completed')}
              >
                {closing ? 'Closing…' : 'Close — completed'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={closing}
                onClick={() => void closeMission('completed_with_exception')}
              >
                Close — completed_with_exception
              </Button>
            </div>
          </div>
        </section>
      )}

      {terminalOutcome && (
        <section className="mb-10 animate-fade-up" style={{ animationDelay: '40ms' }}>
          <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
            Terminal outcome
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Recorded on the mission — waivers are visible here, not silent.
          </p>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm border border-border/70 rounded-md p-3">
            <div>
              <dt className="text-muted-foreground text-xs">status</dt>
              <dd className="font-mono">{String(terminalOutcome.status ?? '—')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">approvals</dt>
              <dd className="font-mono">{String(terminalOutcome.approvals ?? '—')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">executions</dt>
              <dd className="font-mono">{String(terminalOutcome.executions ?? '—')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">executionCostUnits</dt>
              <dd className="font-mono">{String(terminalOutcome.executionCostUnits ?? '—')}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-muted-foreground text-xs">steps</dt>
              <dd className="font-mono text-xs whitespace-pre-wrap mt-1">
                {typeof terminalOutcome.steps === 'object' && terminalOutcome.steps
                  ? JSON.stringify(terminalOutcome.steps, null, 2)
                  : String(terminalOutcome.steps ?? '—')}
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-muted-foreground text-xs">workflowDefect</dt>
              <dd className="font-mono text-xs mt-1">
                found={String((terminalOutcome as { workflowDefectFound?: unknown }).workflowDefectFound ?? '—')}
                {' · '}
                fixed={String((terminalOutcome as { workflowDefectFixed?: unknown }).workflowDefectFixed ?? '—')}
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-muted-foreground text-xs">externalIntegrationDefect</dt>
              <dd className="font-mono text-xs mt-1">
                {String(terminalOutcome.externalIntegrationDefect ?? '—')}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <section className="mb-10 animate-fade-up" style={{ animationDelay: '60ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Business outcomes
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Durable outcomes from Runtime/Data for this mission — empty when none recorded.
        </p>
        {outcomes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No durable outcomes for this mission.</p>
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
                  run {o.runId}
                  {o.value != null && (
                    <span>
                      {' · '}
                      {o.value}
                      {o.currency ? ` ${o.currency}` : ''}
                    </span>
                  )}
                  {o.measuredAt && <span> · {o.measuredAt}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10 animate-fade-up" style={{ animationDelay: '80ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Mission economics
        </h2>
        {!economics ? (
          <p className="text-sm text-muted-foreground">No economics rollup from API.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MetricLink
              label="Cost units"
              value={economics.totalCostUnits}
              to={costContributors[0] ? `/executions/${costContributors[0].executionId}` : undefined}
              hint="drill → executions with cost"
            />
            <MetricLink
              label="Failures / denials"
              value={economics.failureCount + economics.policyDenials}
              tone="danger"
              to={failed[0] ? `/executions/${failed[0].executionId}` : undefined}
            />
            <MetricLink label="Attributed EV" value={economics.attributedEconomicValue} tone="ok" />
            <MetricLink label="ROI" value={economics.roi} />
            <MetricLink label="Executions" value={economics.totalExecutions} />
            <MetricLink label="Successes" value={economics.successCount} tone="ok" />
            <MetricLink label="Approvals" value={economics.approvals} tone="warn" />
            <MetricLink label="Interventions" value={economics.humanInterventions} />
          </div>
        )}
      </section>

      <section className="mb-10 animate-fade-up" style={{ animationDelay: '140ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Cost contributors
        </h2>
        {costContributors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cost-bearing executions for this mission.</p>
        ) : (
          <ul className="divide-y divide-border/70 border border-border/70 rounded-md">
            {costContributors.map((e) => (
              <li key={e.executionId}>
                <Link
                  to={`/executions/${e.executionId}`}
                  className="flex justify-between gap-3 px-3 py-2 text-sm hover:bg-accent/30"
                >
                  <span className="font-mono text-xs truncate">{e.executionId}</span>
                  <span className="font-mono tabular-nums">{e.cost?.units ?? 0} u</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10 animate-fade-up" style={{ animationDelay: '200ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Failures
        </h2>
        {failed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No failed/denied executions from API.</p>
        ) : (
          <ul className="divide-y divide-border/70 border border-border/70 rounded-md">
            {failed.map((e) => (
              <li key={e.executionId}>
                <Link
                  to={`/executions/${e.executionId}`}
                  className="flex justify-between gap-3 px-3 py-2 text-sm hover:bg-accent/30"
                >
                  <span className="font-mono text-xs truncate">{e.executionId}</span>
                  <Badge variant="destructive">{e.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="animate-fade-up" style={{ animationDelay: '260ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Lineage
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Mission → Workflow → Execution → Service/Agent (from execution objects)
        </p>
        {lineageRoots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No execution lineage for this mission.</p>
        ) : (
          <div className="space-y-4">
            {lineageRoots.map(([rootId, nodes]) => (
              <div key={rootId} className="rounded-md border border-border/70 bg-card/40 p-3">
                <div className="font-mono text-[0.65rem] text-muted-foreground mb-2">
                  root {rootId}
                </div>
                <ol className="space-y-2">
                  {nodes
                    .slice()
                    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
                    .map((e) => (
                      <li key={e.executionId} className="text-sm border-l-2 border-primary/40 pl-3">
                        <Link
                          to={`/executions/${e.executionId}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {e.executionId}
                        </Link>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          <span>{e.status}</span>
                          {e.workflowId && <span> · wf {e.workflowId}</span>}
                          {e.agentUri && <span> · {e.agentUri}</span>}
                          {e.metadata && typeof e.metadata === 'object' && 'serviceKey' in e.metadata && (
                            <span> · svc {String((e.metadata as { serviceKey?: string }).serviceKey)}</span>
                          )}
                        </div>
                      </li>
                    ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
