import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { MetricLink } from '@/components/MetricLink';
import { ApprovalPanel } from '@/components/ApprovalPanel';
import { useTenant } from '@/hooks/useTenant';
import { RuntimeApi } from '@/lib/runtime-api';
import type { ApprovalRequest, EconomicsRollup, ExecutionObject, Mission } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

const PORTFOLIO = [
  { key: 'systems', label: 'Systems', domain: 'revenue' },
  { key: 'media', label: 'Media', domain: 'media' },
  { key: 'gstar', label: 'G-Star', domain: 'media' },
  { key: 'assets', label: 'Assets', domain: null },
  { key: 'frontier', label: 'Frontier', domain: null },
] as const;

/**
 * Holding Overview — every number resolves from Runtime economics / lists.
 * HARD RULE: no mock KPI generators; empty API → empty state.
 */
export default function HoldingOverview() {
  const { tenantId } = useTenant();
  const [economics, setEconomics] = useState<EconomicsRollup | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [executions, setExecutions] = useState<ExecutionObject[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      RuntimeApi.getEconomics(tenantId),
      RuntimeApi.listMissions(tenantId),
      RuntimeApi.listExecutions(tenantId, 200),
      RuntimeApi.listApprovals(tenantId, 'pending'),
    ])
      .then(([econ, missionsBody, exeBody, apprBody]) => {
        if (cancelled) return;
        setEconomics(econ.economics ?? null);
        setMissions(missionsBody.missions ?? []);
        setExecutions(exeBody.executions ?? []);
        setApprovals(apprBody.approvals ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEconomics(null);
        setMissions([]);
        setExecutions([]);
        setApprovals([]);
        setError(err instanceof Error ? err.message : 'Failed to load holding data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const health = useMemo(() => {
    const byStatus = (s: string) => missions.filter((m) => m.status === s).length;
    const awaiting = approvals.length;
    const failedMissions = byStatus('failed');
    const failedExe = executions.filter((e) => e.status === 'failed' || e.status === 'denied').length;
    return {
      active: byStatus('active') + byStatus('running'),
      completed: byStatus('completed'),
      failed: failedMissions,
      paused: byStatus('paused'),
      awaiting,
      failedExe,
    };
  }, [missions, approvals, executions]);

  const domainsPresent = useMemo(() => {
    const set = new Set(executions.map((e) => e.domain).filter(Boolean) as string[]);
    return set;
  }, [executions]);

  const firstMission = missions[0]?.missionId;
  const avgLatency =
    economics && economics.totalExecutions > 0
      ? Math.round(economics.totalDurationMs / economics.totalExecutions)
      : null;
  const successRate =
    economics && economics.totalExecutions > 0
      ? `${((economics.successCount / economics.totalExecutions) * 100).toFixed(1)}%`
      : null;

  return (
    <Shell
      onOpenApprovals={() => setPanelOpen(true)}
      pendingCount={approvals.length}
    >
      <section className="relative mb-10 animate-fade-up">
        <div className="pointer-events-none absolute -inset-x-4 -top-6 h-40 ops-grid opacity-30" />
        <p className="text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
          Holding overview
        </p>
        <h1 className="mt-2 font-display text-5xl md:text-6xl font-semibold tracking-tight text-foreground">
          AION
        </h1>
        <p className="mt-3 max-w-xl text-sm md:text-base text-muted-foreground">
          Machine workforce pane of glass. Metrics resolve from Runtime economics,
          executions, and approvals — never invented dashboard state.
        </p>
        {loading && (
          <p className="mt-4 text-sm text-muted-foreground animate-pulse-soft">
            Loading canonical truth…
          </p>
        )}
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </section>

      <section className="mb-10 animate-fade-up" style={{ animationDelay: '60ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Portfolio
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {PORTFOLIO.map((p) => {
            const live = p.domain ? domainsPresent.has(p.domain) : false;
            const count = p.domain
              ? executions.filter((e) => e.domain === p.domain).length
              : null;
            return (
              <div
                key={p.key}
                className="rounded-md border border-border/70 bg-card/40 px-3 py-3"
              >
                <div className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                  {p.label}
                </div>
                {p.domain === null ? (
                  <p className="mt-2 text-xs text-muted-foreground">Stub — no data domain yet</p>
                ) : live ? (
                  <Link
                    to="/?filter=executions"
                    className="mt-2 block font-mono text-lg text-foreground hover:text-primary"
                  >
                    {count}
                    <span className="ml-2 text-[0.65rem] uppercase text-ok">live</span>
                  </Link>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No executions for domain</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-10 animate-fade-up" style={{ animationDelay: '120ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Mission health
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <MetricLink label="Active" value={health.active} to={firstMission ? `/missions/${firstMission}` : undefined} />
          <MetricLink label="Completed" value={health.completed} to={firstMission ? `/missions/${firstMission}` : undefined} tone="ok" />
          <MetricLink label="Failed" value={health.failed} to="/?status=failed" tone="danger" />
          <MetricLink label="Paused" value={health.paused} />
          <button
            type="button"
            className="block text-left rounded-md border border-border/80 bg-card/60 px-3.5 py-3 transition-colors hover:border-primary/50 hover:bg-accent/40"
            onClick={() => setPanelOpen(true)}
          >
            <div className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              Awaiting approval
            </div>
            <div className="mt-1 font-display text-2xl tabular-nums tracking-tight text-warn">
              {health.awaiting}
            </div>
          </button>
        </div>
      </section>

      <section className="mb-10 animate-fade-up" style={{ animationDelay: '180ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Workforce
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <MetricLink
            label="Executions"
            value={economics?.totalExecutions}
            to={executions[0] ? `/executions/${executions[0].executionId}` : undefined}
          />
          <MetricLink label="Success rate" value={successRate} tone="ok" />
          <MetricLink
            label="Human interventions"
            value={economics?.humanInterventions}
            hint="from economics rollup"
          />
          <MetricLink
            label="Policy denials"
            value={economics?.policyDenials}
            tone="danger"
            to={
              executions.find((e) => e.status === 'denied')
                ? `/executions/${executions.find((e) => e.status === 'denied')!.executionId}`
                : undefined
            }
          />
          <MetricLink label="Avg latency (ms)" value={avgLatency} hint="duration / executions" />
        </div>
      </section>

      <section className="mb-10 animate-fade-up" style={{ animationDelay: '240ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Economics
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <MetricLink
            label="Execution cost"
            value={economics?.totalCostUnits}
            to={firstMission ? `/missions/${firstMission}` : undefined}
            hint="holding rollup units"
          />
          <MetricLink
            label="Mission cost"
            value={economics?.totalCostUnits}
            to={firstMission ? `/missions/${firstMission}` : undefined}
            hint="same holding cost in MVP"
          />
          <MetricLink label="Attributed value" value={economics?.attributedEconomicValue} tone="ok" />
          <MetricLink label="EV / Cost (ROI)" value={economics?.roi ?? null} />
          <MetricLink
            label="Revenue influenced"
            value={economics?.attributedEconomicValue}
            hint="attributed EV from API"
          />
        </div>
      </section>

      <section className="mb-10 animate-fade-up" style={{ animationDelay: '300ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Risk
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MetricLink
            label="R2 / R3 executions"
            value={
              executions.filter((e) => e.riskLevel === 'R2' || e.riskLevel === 'R3').length
            }
          />
          <MetricLink
            label="Pending approvals"
            value={approvals.length}
            tone="warn"
          />
          <MetricLink
            label="Failed executions"
            value={health.failedExe}
            tone="danger"
            to={
              executions.find((e) => e.status === 'failed' || e.status === 'denied')
                ? `/executions/${
                    executions.find((e) => e.status === 'failed' || e.status === 'denied')!
                      .executionId
                  }`
                : undefined
            }
          />
          {/* Budget overruns omitted — field not present on economics rollup */}
        </div>
      </section>

      <section className="animate-fade-up" style={{ animationDelay: '360ms' }}>
        <div className="flex items-end justify-between mb-3">
          <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground">
            Missions
          </h2>
          <span className="font-mono text-xs text-muted-foreground">{missions.length} from API</span>
        </div>
        {missions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No missions referenced by executions for this tenant.
          </p>
        ) : (
          <ul className="divide-y divide-border/70 border border-border/70 rounded-md overflow-hidden">
            {missions.slice(0, 12).map((m) => (
              <li key={m.missionId}>
                <Link
                  to={`/missions/${m.missionId}`}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-accent/30"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{m.name}</div>
                    <div className="font-mono text-[0.65rem] text-muted-foreground truncate">
                      {m.missionId}
                    </div>
                  </div>
                  <Badge variant="secondary">{m.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ApprovalPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        approvals={approvals}
        loading={loading}
        error={error}
      />
    </Shell>
  );
}
