import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { ApprovalPanel } from '@/components/ApprovalPanel';
import { useTenant } from '@/hooks/useTenant';
import { missionCohortLabel } from '@/lib/cohort';
import { RuntimeApi } from '@/lib/runtime-api';
import type { ApprovalRequest, EconomicsRollup, ExecutionObject, Mission } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type StatusFilter = 'all' | 'active' | 'completed' | 'failed' | 'paused';

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'paused', label: 'Paused' },
];

function matchesFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return status === 'active' || status === 'running';
  if (filter === 'failed') return status === 'failed' || status === 'denied';
  return status === filter;
}

/**
 * Mission Control — operate missions: filter, inspect lineage entry points,
 * economics, failures, pending approvals. Writes only via Runtime.
 */
export default function MissionControl() {
  const { tenantId } = useTenant();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('status') as StatusFilter) || 'all';

  const [missions, setMissions] = useState<Mission[]>([]);
  const [executions, setExecutions] = useState<ExecutionObject[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [economics, setEconomics] = useState<EconomicsRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      RuntimeApi.listMissions(tenantId),
      RuntimeApi.listExecutions(tenantId, 200),
      RuntimeApi.listApprovals(tenantId, 'pending'),
      RuntimeApi.getEconomics(tenantId),
    ])
      .then(([m, e, a, econ]) => {
        if (cancelled) return;
        setMissions(m.missions ?? []);
        setExecutions(e.executions ?? []);
        setApprovals(a.approvals ?? []);
        setEconomics(econ.economics ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMissions([]);
        setExecutions([]);
        setApprovals([]);
        setEconomics(null);
        setError(err instanceof Error ? err.message : 'Failed to load Mission Control');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, tick]);

  const filtered = useMemo(
    () => missions.filter((m) => matchesFilter(m.status, filter)),
    [missions, filter],
  );

  const byMission = useMemo(() => {
    const map = new Map<string, ExecutionObject[]>();
    for (const e of executions) {
      if (!e.missionId) continue;
      const arr = map.get(e.missionId) ?? [];
      arr.push(e);
      map.set(e.missionId, arr);
    }
    return map;
  }, [executions]);

  const interventionRate =
    economics && economics.totalExecutions > 0
      ? `${((economics.humanInterventions / economics.totalExecutions) * 100).toFixed(1)}%`
      : null;
  const costPerMission =
    economics && missions.length > 0
      ? (economics.totalCostUnits / missions.length).toFixed(1)
      : null;
  const evPerExe =
    economics && economics.totalExecutions > 0
      ? (economics.attributedEconomicValue / economics.totalExecutions).toFixed(2)
      : null;

  return (
    <Shell
      onOpenApprovals={() => setPanelOpen(true)}
      pendingCount={approvals.length}
    >
      <header className="mb-8 animate-fade-up">
        <p className="text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
          UX-001 · Mission Control
        </p>
        <h1 className="mt-2 font-display text-4xl md:text-5xl font-semibold tracking-tight">
          Missions
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Filter, inspect lineage, economics, and failures. Approve gated actions
          through Runtime — never invent authority in the UI.{' '}
          <Link className="text-primary underline-offset-2 hover:underline" to="/missions/new">
            Launch a mission
          </Link>
          .
        </p>
        {loading && (
          <p className="mt-4 text-sm text-muted-foreground animate-pulse-soft">Loading…</p>
        )}
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </header>

      <section className="mb-8 grid grid-cols-2 md:grid-cols-4 gap-2 animate-fade-up">
        <Kpi label="Missions" value={missions.length} />
        <Kpi label="Human intervention rate" value={interventionRate} />
        <Kpi label="Cost / mission" value={costPerMission} />
        <Kpi label="EV / execution" value={evPerExe} />
      </section>

      <div className="mb-4 flex flex-wrap gap-1.5 animate-fade-up">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={cn(
              'rounded-md px-3 py-1.5 text-xs uppercase tracking-[0.12em] border border-border/70',
              filter === f.id
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (f.id === 'all') next.delete('status');
              else next.set('status', f.id);
              setParams(next);
            }}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-xs text-muted-foreground self-center">
          {filtered.length} shown
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No missions match this filter.</p>
      ) : (
        <ul className="divide-y divide-border/70 border border-border/70 rounded-md overflow-hidden animate-fade-up">
          {filtered.map((m) => {
            const exes = byMission.get(m.missionId) ?? [];
            const failed = exes.filter(
              (e) => e.status === 'failed' || e.status === 'denied',
            ).length;
            const pending = approvals.filter((a) => a.missionId === m.missionId).length;
            const company = exes.find((e) => e.companyId)?.companyId;
            return (
              <li key={m.missionId}>
                <Link
                  to={`/missions/${m.missionId}`}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-2 px-3 py-3 hover:bg-accent/30"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{m.name}</div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {m.objective}
                    </div>
                    <div className="font-mono text-[0.65rem] text-muted-foreground mt-1 truncate">
                      {m.missionId}
                      {company ? ` · company ${company}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {missionCohortLabel(m) === 'PRE-OL' && (
                      <Badge variant="outline">PRE-OL</Badge>
                    )}
                    {missionCohortLabel(m) === 'OL-001' && (
                      <Badge variant="outline">OL-001</Badge>
                    )}
                    <Badge variant="secondary">{m.status}</Badge>
                    <span className="font-mono text-[0.65rem] text-muted-foreground">
                      {exes.length} exe
                    </span>
                    {failed > 0 && (
                      <Badge variant="destructive">{failed} failed</Badge>
                    )}
                    {pending > 0 && <Badge variant="warn">{pending} pending</Badge>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
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

function Kpi({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-md border border-border/70 bg-card/40 px-3 py-3">
      <div className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-display text-xl tabular-nums">
        {value === null || value === undefined ? '—' : value}
      </div>
    </div>
  );
}
