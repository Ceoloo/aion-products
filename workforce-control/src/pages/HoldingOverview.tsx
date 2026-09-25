import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { MetricLink } from '@/components/MetricLink';
import { ApprovalPanel } from '@/components/ApprovalPanel';
import { useTenant } from '@/hooks/useTenant';
import { RuntimeApi } from '@/lib/runtime-api';
import type { ApprovalRequest, EconomicsRollup, ExecutionObject, Mission } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AttentionRail,
  EmptyState,
  ErrorState,
  LoadState,
  type AttentionItem,
} from '@/components/WorkflowState';

/**
 * Command Center — Attention → Act → Outcomes.
 * HARD RULE: no mock KPI generators; empty API → empty state.
 * Phase 1 (UX-R1): collapse ornamental metric grids; one compact rollup only.
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
  const [tick, setTick] = useState(0);

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
  }, [tenantId, tick]);

  const attentionItems = useMemo((): AttentionItem[] => {
    const items: AttentionItem[] = [];
    for (const a of approvals) {
      items.push({
        id: `approval-${a.approvalId}`,
        kind: 'approval',
        label: (a.reason && a.reason.trim()) || a.approvalId,
        detail:
          [a.riskLevel ? `risk ${a.riskLevel}` : null, a.missionId]
            .filter(Boolean)
            .join(' · ') || undefined,
        to: a.missionId
          ? `/missions/${a.missionId}`
          : a.executionId
            ? `/executions/${a.executionId}`
            : undefined,
        onAct: () => setPanelOpen(true),
        actLabel: 'Decide',
      });
    }
    for (const m of missions.filter((x) => x.status === 'failed' || x.status === 'denied')) {
      items.push({
        id: `mission-fail-${m.missionId}`,
        kind: 'failure',
        label: m.name,
        detail: m.missionId,
        to: `/missions/${m.missionId}`,
      });
    }
    for (const e of executions
      .filter((x) => x.status === 'failed' || x.status === 'denied')
      .slice(0, 8)) {
      items.push({
        id: `exe-fail-${e.executionId}`,
        kind: 'failure',
        label: e.executionId,
        detail: [e.status, e.missionId].filter(Boolean).join(' · '),
        to: `/executions/${e.executionId}`,
      });
    }
    return [
      ...items.filter((i) => i.kind === 'approval'),
      ...items.filter((i) => i.kind !== 'approval'),
    ].slice(0, 12);
  }, [approvals, missions, executions]);

  const activeMissions = useMemo(
    () =>
      missions.filter(
        (m) => m.status === 'active' || m.status === 'running' || m.status === 'paused',
      ),
    [missions],
  );

  const successRate =
    economics && economics.totalExecutions > 0
      ? `${((economics.successCount / economics.totalExecutions) * 100).toFixed(1)}%`
      : null;

  return (
    <Shell
      onOpenApprovals={() => setPanelOpen(true)}
      pendingCount={approvals.length}
    >
      <section className="relative mb-8 animate-fade-up">
        <div className="pointer-events-none absolute -inset-x-4 -top-6 h-40 ops-grid opacity-30" />
        <p className="text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
          UX-001 · Command Center
        </p>
        <h1 className="mt-2 font-display text-5xl md:text-6xl font-semibold tracking-tight text-foreground">
          AION
        </h1>
        <p className="mt-3 max-w-lg text-sm text-muted-foreground">
          What needs your decision? Approvals and failures first — then act.
          Cohort pulse lives on the{' '}
          <Link className="text-primary underline-offset-2 hover:underline" to="/ol001">
            OL-001 scoreboard
          </Link>
          .
        </p>
        {loading && <LoadState label="Loading canonical truth…" />}
        {error && <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} />}
      </section>

      {/* 1. Attention */}
      <AttentionRail items={attentionItems} loading={loading && !error} />

      {/* 2. Act */}
      <section className="mb-10 animate-fade-up" style={{ animationDelay: '40ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Act
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link to="/missions/new">Launch mission</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/missions?status=active">Open active missions</Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={approvals.length === 0}
            onClick={() => setPanelOpen(true)}
          >
            Decide approvals{approvals.length > 0 ? ` (${approvals.length})` : ''}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/implementations">IE-001 cases</Link>
          </Button>
        </div>
      </section>

      {/* Compact holding rollup — drill-through only, no duplicate grids */}
      <section className="mb-10 animate-fade-up" style={{ animationDelay: '80ms' }}>
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Holding rollup
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MetricLink label="Missions" value={missions.length} to="/missions" />
          <MetricLink
            label="Active"
            value={activeMissions.length}
            to="/missions?status=active"
          />
          <MetricLink label="Success rate" value={successRate} tone="ok" to="/ol001" />
          <MetricLink
            label="Pending approvals"
            value={approvals.length}
            tone="warn"
          />
        </div>
        <p className="mt-2 text-[0.7rem] text-muted-foreground">
          Full economics and cohort KPIs:{' '}
          <Link className="text-primary underline-offset-2 hover:underline" to="/ol001">
            OL-001
          </Link>
          {' · '}
          <Link className="text-primary underline-offset-2 hover:underline" to="/missions">
            Mission Control
          </Link>
        </p>
      </section>

      {/* 3. Outcomes — mission list */}
      <section className="animate-fade-up" style={{ animationDelay: '120ms' }}>
        <div className="flex items-end justify-between mb-3">
          <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground">
            Outcomes · recent missions
          </h2>
          <Link
            to="/missions"
            className="font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            Mission Control →
          </Link>
        </div>
        {missions.length === 0 ? (
          <EmptyState
            title="No missions for this tenant"
            detail="Runtime returned an empty mission list — launch work or switch tenant."
            actionTo="/missions/new"
            actionLabel="Launch mission"
          />
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
        tenantId={tenantId}
        onDecided={() => setTick((t) => t + 1)}
      />
    </Shell>
  );
}
