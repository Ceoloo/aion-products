import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { ApprovalPanel } from '@/components/ApprovalPanel';
import { useTenant } from '@/hooks/useTenant';
import {
  isCompletedWithException,
  isOl001ProductionMission,
  isPreOlValidationMission,
} from '@/lib/cohort';
import { RuntimeApi } from '@/lib/runtime-api';
import type { ApprovalRequest, EconomicsRollup, ExecutionObject, Mission } from '@/lib/types';

const COHORT_TARGET = 100;

/**
 * OL-001 scoreboard heartbeat.
 * HARD RULE: numbers only from API. Empty → "—".
 * Protect: pipeline ≠ attributed ≠ collected.
 * Protect: PRE-OL validation missions never inflate 0/100 progress.
 */
export default function Ol001Scoreboard() {
  const { tenantId } = useTenant();
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
      RuntimeApi.listExecutions(tenantId, 500),
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
        setError(err instanceof Error ? err.message : 'Failed to load scoreboard');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, tick]);

  /** Strict: only explicit OL-001 production-economic missions count. */
  const cohortMissions = useMemo(
    () => missions.filter(isOl001ProductionMission),
    [missions],
  );

  const preOl = useMemo(() => {
    const preMissions = missions.filter(isPreOlValidationMission);
    const preIds = new Set(preMissions.map((m) => m.missionId));
    const preExecutions = executions.filter(
      (e) => e.missionId && preIds.has(e.missionId),
    );
    return {
      missions: preMissions.length,
      executions: preExecutions.length || null,
    };
  }, [missions, executions]);

  const production = useMemo(() => {
    const by = (s: string) => cohortMissions.filter((m) => m.status === s).length;
    const withException = cohortMissions.filter(isCompletedWithException).length;
    const completed = cohortMissions.filter((m) => m.status === 'completed');
    const successfulClean = completed.filter((m) => !isCompletedWithException(m)).length;
    return {
      real: cohortMissions.length,
      successful: successfulClean,
      completedWithException: withException,
      failed: by('failed') + by('cancelled'),
      inProgress: by('active') + by('running') + by('paused'),
    };
  }, [cohortMissions]);

  const human = useMemo(() => {
    const interventionRate =
      economics && economics.totalExecutions > 0
        ? `${((economics.humanInterventions / economics.totalExecutions) * 100).toFixed(1)}%`
        : null;
    const approvalsPerMission =
      cohortMissions.length > 0 && economics
        ? (economics.approvals / cohortMissions.length).toFixed(2)
        : null;
    return { interventionRate, approvalsPerMission, humanMinutes: null as string | null };
  }, [economics, cohortMissions.length]);

  const econ = useMemo(() => {
    if (!economics || cohortMissions.length === 0) {
      return {
        costPerMission: null as string | null,
        costPerSuccess: null as string | null,
        evPerExe: null as string | null,
        evPerCost: null as string | number | null,
      };
    }
    const costPerMission = (economics.totalCostUnits / cohortMissions.length).toFixed(2);
    const costPerSuccess =
      production.successful > 0
        ? (economics.totalCostUnits / production.successful).toFixed(2)
        : null;
    const evPerExe =
      economics.totalExecutions > 0
        ? (economics.attributedEconomicValue / economics.totalExecutions).toFixed(2)
        : null;
    return {
      costPerMission,
      costPerSuccess,
      evPerExe,
      evPerCost: economics.roi,
    };
  }, [economics, cohortMissions.length, production.successful]);

  const reliability = useMemo(() => {
    const total = economics?.totalExecutions ?? 0;
    const failureRate =
      total > 0 && economics
        ? `${((economics.failureCount / total) * 100).toFixed(1)}%`
        : null;
    const policyViolations = economics?.policyDenials ?? null;
    const externalFailures = executions.filter(
      (e) =>
        e.status === 'failed' &&
        (e.domain === 'crm' ||
          String(e.outcomeSummary ?? '').toLowerCase().includes('ghl') ||
          String(e.outcomeSummary ?? '').toLowerCase().includes('external')),
    ).length;
    return {
      failureRate,
      retryRate: null as string | null,
      policyViolations,
      externalFailures: externalFailures || null,
    };
  }, [economics, executions]);

  return (
    <Shell
      onOpenApprovals={() => setPanelOpen(true)}
      pendingCount={approvals.length}
    >
      <header className="mb-8 animate-fade-up">
        <p className="text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
          OL-001 · Revenue Production · LIVE
        </p>
        <h1 className="mt-2 font-display text-4xl md:text-5xl font-semibold tracking-tight">
          Scoreboard
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Heartbeat for the 100-mission cohort. Counts only missions with{' '}
          <span className="font-mono text-xs">cohort=OL-001</span> and{' '}
          <span className="font-mono text-xs">productionEconomic=true</span>.
          PRE-OL validation is preserved but excluded. Pipeline ≠ attributed ≠
          collected.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link className="text-primary underline-offset-2 hover:underline" to="/missions/new">
            + Launch mission (PRE-OL or OL-001 Production)
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" to="/missions">
            Mission Control
          </Link>
        </div>
        {loading && (
          <p className="mt-4 text-sm text-muted-foreground animate-pulse-soft">Loading…</p>
        )}
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </header>

      <div className="space-y-8 animate-fade-up" style={{ animationDelay: '40ms' }}>
        <Section title="OL-001 progress (production only)">
          <Row
            label="Real missions"
            value={`${production.real} / ${COHORT_TARGET}`}
            emphasize
          />
          <Row label="Successful" value={fmt(production.successful)} />
          <Row
            label="Completed with exception"
            value={fmt(production.completedWithException)}
            hint="waiver recorded on mission.terminalOutcome — not silent success"
          />
          <Row label="Failed" value={fmt(production.failed)} />
          <Row label="In progress" value={fmt(production.inProgress)} />
        </Section>

        <Section title="PRE-OL validation (excluded from 100)">
          <Row
            label="Validation missions"
            value={fmt(preOl.missions)}
            hint="system tests / console launches before live GHL+model gates"
          />
          <Row
            label="Validation executions"
            value={fmt(preOl.executions)}
            hint="useful Runtime evidence — not revenue production"
          />
        </Section>

        <Section title="Throughput">
          <Row label="Missions / day" value="—" hint="needs cohort date window" />
          <Row label="Median completion time" value="—" hint="needs duration distribution" />
        </Section>

        <Section title="Human load">
          <Row
            label="Intervention rate"
            value={fmt(human.interventionRate)}
            hint="tenant-wide until cohort-scoped economics exist"
          />
          <Row label="Approvals / mission" value={fmt(human.approvalsPerMission)} />
          <Row label="Human minutes / mission" value="—" hint="operator time not yet instrumented" />
        </Section>

        <Section title="Economics">
          <Row
            label="Cost / mission"
            value={fmt(econ.costPerMission)}
            hint={cohortMissions.length === 0 ? 'no OL-001 production missions yet' : undefined}
          />
          <Row label="Cost / successful mission" value={fmt(econ.costPerSuccess)} />
          <Row label="Economic value / execution" value={fmt(econ.evPerExe)} />
          <Row label="EV / execution cost" value={fmt(econ.evPerCost)} />
        </Section>

        <Section title="Revenue">
          <Row
            label="Pipeline created"
            value="—"
            hint="≠ attributed ≠ collected — not yet a separate API field"
          />
          <Row label="Revenue influenced" value="—" hint="soft assist — keep separate" />
          <Row
            label="Revenue attributed"
            value={
              cohortMissions.length > 0
                ? fmt(economics?.attributedEconomicValue)
                : '—'
            }
            hint="only meaningful once OL-001 production missions exist"
          />
          <Row label="Revenue collected" value="—" hint="cash only — never conflate" />
        </Section>

        <Section title="Reliability">
          <Row label="Failure rate" value={fmt(reliability.failureRate)} />
          <Row label="Retry rate" value="—" hint="policy-aware retry not yet instrumented" />
          <Row label="Policy violations" value={fmt(reliability.policyViolations)} />
          <Row label="External-system failures" value={fmt(reliability.externalFailures)} />
        </Section>
      </div>

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
        {title}
      </h2>
      <dl className="divide-y divide-border/60 border border-border/70 rounded-md overflow-hidden">
        {children}
      </dl>
    </section>
  );
}

function Row({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2.5 bg-card/30">
      <dt className="text-sm text-muted-foreground">
        {label}
        {hint && <span className="block text-[0.65rem] opacity-80">{hint}</span>}
      </dt>
      <dd
        className={
          emphasize
            ? 'font-display text-xl tabular-nums'
            : 'font-mono text-sm tabular-nums text-foreground'
        }
      >
        {value}
      </dd>
    </div>
  );
}

function fmt(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}
