import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { MetricLink } from '@/components/MetricLink';
import { useTenant } from '@/hooks/useTenant';
import { missionCohortLabel, isCompletedWithException } from '@/lib/cohort';
import { RuntimeApi } from '@/lib/runtime-api';
import type { ApprovalRequest, EconomicsRollup, ExecutionObject, Mission, OutcomeRecord } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApprovalPanel } from '@/components/ApprovalPanel';
import { ErrorState, LoadState } from '@/components/WorkflowState';

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
  const [outcomeSummary, setOutcomeSummary] = useState('');
  const [businessValue, setBusinessValue] = useState('');
  const [valueEvidence, setValueEvidence] = useState('');
  const [waivedStep, setWaivedStep] = useState('');
  const [waiverReason, setWaiverReason] = useState('');
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tick, setTick] = useState(0);

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
      RuntimeApi.listApprovals(tenantId, 'pending').catch(() => ({
        approvals: [] as ApprovalRequest[],
      })),
    ])
      .then(([m, e, list, out, appr]) => {
        if (cancelled) return;
        setMission(m.mission ?? null);
        setEconomics(e.economics ?? null);
        setExecutions(
          (list.executions ?? []).filter((x) => x.missionId === missionId),
        );
        setOutcomes(out.outcomes ?? []);
        setApprovals(
          (appr.approvals ?? []).filter((a) => a.missionId === missionId),
        );
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
  }, [tenantId, missionId, tick]);

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

  const retryCount = useMemo(() => {
    const attempts = new Map<number, number>();
    for (const execution of executions) {
      const index = execution.metadata?.missionStepIndex;
      if (typeof index === 'number') attempts.set(index, (attempts.get(index) ?? 0) + 1);
    }
    return [...attempts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  }, [executions]);

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

  /**
   * Close the mission with evidence the Runtime can account for:
   *  1. a durable `realized` Outcome (USD value) on the mission's latest run —
   *     this is what mission economics counts as attributed value;
   *  2. a mission PATCH whose terminalOutcome references that outcome and the
   *     Runtime-computed human intervention count.
   * Every field comes from the operator or the Runtime; nothing is prefilled.
   */
  async function closeMission(mode: 'completed' | 'completed_with_exception') {
    if (!mission) return;
    const summary = outcomeSummary.trim();
    const value = Number(businessValue);
    const exceptionStep = waivedStep.trim();
    const exceptionReason = waiverReason.trim();
    if (!summary) {
      setCloseError('Outcome summary is required.');
      return;
    }
    if (businessValue.trim() === '' || !Number.isFinite(value) || value < 0) {
      setCloseError('Business value must be a number ≥ 0 (USD). Enter 0 if none was realized.');
      return;
    }
    if (approvals.length > 0 || executions.some((e) => e.status === 'awaiting_approval')) {
      setCloseError('A governed action is still awaiting a human decision.');
      return;
    }
    const expectedSteps = Number(mission.metadata?.automatedStepCount);
    if (mode === 'completed' && Number.isFinite(expectedSteps) && expectedSteps > 0 &&
        (economics?.successCount ?? 0) < expectedSteps) {
      setCloseError(`The workflow has completed ${economics?.successCount ?? 0} of ${expectedSteps} automated steps.`);
      return;
    }
    if (mode === 'completed' && executions.some((e) => e.status === 'failed' || e.status === 'denied')) {
      setCloseError('This mission has a failed or denied step. Use an exception close with a documented waiver.');
      return;
    }
    if (value > 0 && !valueEvidence.trim()) {
      setCloseError('Add the CRM record or other evidence supporting a positive business value.');
      return;
    }
    if (mode === 'completed_with_exception' && (!exceptionStep || !exceptionReason)) {
      setCloseError('An exception close needs the waived step and the exact reason.');
      return;
    }
    // A retry after a partial failure must not record the value twice: reuse the
    // terminal outcome already on this mission, and refuse a conflicting value.
    const existingTerminal = outcomes.find(
      (o) => o.outcomeType === 'mission.terminal' && o.status === 'realized',
    );
    if (existingTerminal && existingTerminal.value !== value) {
      setCloseError(
        `A terminal outcome (${existingTerminal.outcomeId}) is already recorded with value ` +
          `${String(existingTerminal.value)} ${existingTerminal.currency ?? ''}. Enter that value to finish closing.`,
      );
      return;
    }
    // Executions come from a tenant-wide recent page; fall back to the runs the
    // mission's own outcomes reference so older missions still have an anchor.
    const anchorRunId =
      [...executions]
        .filter((e) => e.runId)
        .sort((a, b) =>
          String(b.completedAt ?? b.updatedAt ?? b.createdAt ?? '').localeCompare(
            String(a.completedAt ?? a.updatedAt ?? a.createdAt ?? ''),
          ),
        )[0]?.runId ??
      [...outcomes].sort((a, b) =>
        String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
      )[0]?.runId;
    if (!existingTerminal && !anchorRunId) {
      setCloseError('No run found for this mission — there is nothing to attach an outcome to.');
      return;
    }

    setClosing(true);
    setCloseError(null);
    try {
      const closedAt = new Date().toISOString();
      const outcome = existingTerminal ?? (await RuntimeApi.createOutcome(tenantId, {
        runId: anchorRunId!,
        missionId: mission.missionId,
        status: 'realized',
        outcomeType: 'mission.terminal',
        ...(valueEvidence.trim() ? { externalReference: valueEvidence.trim() } : {}),
        value,
        currency: 'USD',
        measuredAt: closedAt,
        metadata: {
          summary,
          ...(valueEvidence.trim() ? { valueEvidence: valueEvidence.trim() } : {}),
          closeMode: mode,
          closedFrom: 'operator-console',
          ...(mode === 'completed_with_exception'
            ? { exception: { waivedStep: exceptionStep, reason: exceptionReason } }
            : {}),
        },
      })).outcome;
      // Re-read economics so the recorded counts include this outcome.
      const { economics: econ } = await RuntimeApi.getMissionEconomics(tenantId, mission.missionId);
      await RuntimeApi.patchMission(tenantId, mission.missionId, {
        status: 'completed',
        metadata: {
          outcomeStatus: mode,
          terminalOutcome: {
            status: mode,
            summary,
            outcomeId: outcome.outcomeId,
            businessValue: value,
            ...(valueEvidence.trim() ? { valueEvidence: valueEvidence.trim() } : {}),
            currency: 'USD',
            humanInterventions: econ?.humanInterventions ?? 0,
            failureCount: econ?.failureCount ?? 0,
            retryCount,
            executionDurationMs: econ?.totalDurationMs ?? 0,
            approvals: econ?.approvals ?? 0,
            executions: econ?.totalExecutions ?? executions.length,
            executionCostUnits: econ?.totalCostUnits ?? 0,
            ...(mode === 'completed_with_exception'
              ? { waivedStep: exceptionStep, reason: exceptionReason }
              : {}),
            closedAt,
            closedFrom: 'operator-console',
          },
        },
      });
      setTick((t) => t + 1);
    } catch (err: unknown) {
      setCloseError(err instanceof Error ? err.message : 'Failed to close mission');
      setTick((t) => t + 1); // reload outcomes so a retry reuses anything already recorded
    } finally {
      setClosing(false);
    }
  }
  return (
    <Shell
      onOpenApprovals={() => setPanelOpen(true)}
      pendingCount={approvals.length}
    >
      <div className="mb-6 text-sm">
        <Link to="/missions" className="text-muted-foreground hover:text-foreground">
          ← Mission Control
        </Link>
      </div>

      {loading && <LoadState label="Loading mission…" />}
      {error && <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} className="mb-4" />}

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
            Records a realized business outcome on the mission&apos;s latest run, then closes the
            mission with the Runtime&apos;s intervention count and cost. Use the exception close only
            when a step was waived, and say exactly which and why.
          </p>
          <div className="space-y-3 rounded-md border border-border/70 p-3 max-w-xl">
            <label className="block text-xs text-muted-foreground">
              Outcome summary
              <input
                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={outcomeSummary}
                onChange={(e) => setOutcomeSummary(e.target.value)}
                placeholder="What changed in the business"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Business value realized (USD)
              <input
                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm"
                inputMode="decimal"
                value={businessValue}
                onChange={(e) => setBusinessValue(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Value evidence / CRM record (required when value is positive)
              <input
                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={valueEvidence}
                onChange={(e) => setValueEvidence(e.target.value)}
                placeholder="GHL opportunity ID, invoice, or evidence URL"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Waived step (exception close only)
              <input
                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
                value={waivedStep}
                onChange={(e) => setWaivedStep(e.target.value)}
                placeholder="e.g. crm.task.create"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Exception reason (exception close only)
              <input
                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
                value={waiverReason}
                onChange={(e) => setWaiverReason(e.target.value)}
                placeholder="Exact error or reason"
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
            Recorded on the mission and backed by a durable outcome — waivers are visible here, not silent.
          </p>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm border border-border/70 rounded-md p-3">
            {(
              [
                ['status', terminalOutcome.status],
                ['summary', terminalOutcome.summary],
                ['businessValue', terminalOutcome.businessValue != null
                  ? `${String(terminalOutcome.businessValue)} ${String(terminalOutcome.currency ?? '')}`.trim()
                  : undefined],
                ['humanInterventions', typeof terminalOutcome.humanInterventions === 'number'
                  ? terminalOutcome.humanInterventions
                  : undefined],
                ['failureCount', terminalOutcome.failureCount],
                ['retryCount', terminalOutcome.retryCount],
                ['executionDurationMs', terminalOutcome.executionDurationMs],
                ['valueEvidence', terminalOutcome.valueEvidence],
                ['approvals', terminalOutcome.approvals],
                ['executions', terminalOutcome.executions],
                ['executionCostUnits', terminalOutcome.executionCostUnits],
                ['outcomeId', terminalOutcome.outcomeId],
                ['waivedStep', terminalOutcome.waivedStep],
                ['reason', terminalOutcome.reason],
                ['closedAt', terminalOutcome.closedAt],
              ] as [string, unknown][]
            )
              .filter(([, v]) => v !== undefined && v !== null && v !== '')
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground text-xs">{k}</dt>
                  <dd className="font-mono break-words">{String(v)}</dd>
                </div>
              ))}
            {/* Legacy OL-001 M001 close records carried these step/defect fields. */}
            {terminalOutcome.steps != null && (
              <div className="md:col-span-2">
                <dt className="text-muted-foreground text-xs">steps</dt>
                <dd className="font-mono text-xs whitespace-pre-wrap mt-1">
                  {typeof terminalOutcome.steps === 'object'
                    ? JSON.stringify(terminalOutcome.steps, null, 2)
                    : String(terminalOutcome.steps)}
                </dd>
              </div>
            )}
            {terminalOutcome.workflowDefectFound != null && (
              <div className="md:col-span-2">
                <dt className="text-muted-foreground text-xs">workflowDefect</dt>
                <dd className="font-mono text-xs mt-1">
                  found={String(terminalOutcome.workflowDefectFound)}
                  {' · '}
                  fixed={String(terminalOutcome.workflowDefectFixed ?? '—')}
                </dd>
              </div>
            )}
            {terminalOutcome.externalIntegrationDefect != null && (
              <div className="md:col-span-2">
                <dt className="text-muted-foreground text-xs">externalIntegrationDefect</dt>
                <dd className="font-mono text-xs mt-1">
                  {String(terminalOutcome.externalIntegrationDefect)}
                </dd>
              </div>
            )}
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
            <MetricLink label="Value / cost unit" value={economics.roi} />
            <MetricLink label="Executions" value={economics.totalExecutions} />
            <MetricLink label="Successes" value={economics.successCount} tone="ok" />
            <MetricLink label="Approvals" value={economics.approvals} tone="warn" />
            <MetricLink label="Interventions" value={economics.humanInterventions} />
            <MetricLink label="Execution time (ms)" value={economics.totalDurationMs} />
            <MetricLink label="Retries" value={retryCount} />
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
