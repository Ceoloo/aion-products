import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { useTenant } from '@/hooks/useTenant';
import { RuntimeApi, RuntimeHttpError } from '@/lib/runtime-api';
import type { ImplementationCase } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const OPERATOR_ID =
  (import.meta.env.VITE_AION_OPERATOR_ID as string | undefined) ?? 'operator-console';

const BOTTLENECKS = [
  {
    value: 'leads_lost_inquiry_followup',
    label: 'Leads lost between inquiry and follow-up → Revenue OS',
  },
  {
    value: 'intake_handoffs_updates_inconsistent',
    label: 'Intake / handoffs / updates inconsistent → Client Ops OS',
  },
  {
    value: 'repetitive_admin_consumes_owner_time',
    label: 'Repetitive admin consumes owner time → AI Workforce Setup',
  },
  {
    value: 'booking_intake_delivery_reviews_disconnected',
    label: 'Booking / intake / delivery / reviews disconnected → Service Stack',
  },
] as const;

/**
 * IE-001 case detail — intake → recommendation → blueprint approve.
 * Provisioning steps are visible; GHL/model remain blocked.
 */
export default function ImplementationDetail() {
  const { caseId = '' } = useParams();
  const { tenantId } = useTenant();
  const [c, setCase] = useState<ImplementationCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [businessContext, setBusinessContext] = useState('');
  const [bottleneck, setBottleneck] = useState(BOTTLENECKS[0].value);
  const [measurableProblem, setMeasurableProblem] = useState('');
  const [namedOwner, setNamedOwner] = useState(OPERATOR_ID);
  const [accessReady, setAccessReady] = useState(true);
  const [approvedScope, setApprovedScope] = useState(true);
  const [capacityOk, setCapacityOk] = useState(true);
  const [needsDiscovery, setNeedsDiscovery] = useState(false);
  const [outOfScope, setOutOfScope] = useState(false);
  const [baselineMetric, setBaselineMetric] = useState('');
  const [targetState, setTargetState] = useState('');
  const [firstWorkflowName, setFirstWorkflowName] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    RuntimeApi.getImplementation(tenantId, caseId)
      .then((res) => {
        setCase(res.case);
        const intake = res.case.intake as Record<string, unknown> | undefined;
        if (intake) {
          if (typeof intake.businessContext === 'string') {
            setBusinessContext(intake.businessContext);
          }
          if (typeof intake.primaryBottleneck === 'string') {
            setBottleneck(intake.primaryBottleneck as typeof bottleneck);
          }
          if (typeof intake.measurableProblem === 'string') {
            setMeasurableProblem(intake.measurableProblem);
          }
          if (typeof intake.namedOwner === 'string') setNamedOwner(intake.namedOwner);
        }
        const bp = res.case.blueprint;
        if (bp && typeof bp.targetState === 'string') setTargetState(bp.targetState);
        const fw = bp?.firstWorkflow as { name?: string } | undefined;
        if (fw?.name) setFirstWorkflowName(fw.name);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load case');
      })
      .finally(() => setLoading(false));
  }, [tenantId, caseId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function submitIntake(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await RuntimeApi.submitImplementationIntake(tenantId, caseId, {
        businessContext,
        primaryBottleneck: bottleneck,
        measurableProblem,
        namedOwner,
        accessReady,
        approvedScope,
        deliveryCapacityFeasible: capacityOk,
        needsDiscovery,
        outOfScope,
        baselineMetric: baselineMetric || undefined,
        modelAccessStatus: 'pending',
        completedBy: OPERATOR_ID,
      });
      setCase(res.case);
    } catch (err: unknown) {
      setError(
        err instanceof RuntimeHttpError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Intake failed',
      );
    } finally {
      setBusy(false);
    }
  }

  async function draftBlueprint() {
    setBusy(true);
    setError(null);
    try {
      const pkg =
        c?.recommendation?.humanOverridePackage ??
        c?.recommendation?.recommendedPackage;
      const res = await RuntimeApi.draftImplementationBlueprint(tenantId, caseId, {
        packageKey: pkg,
        deliveryOwner: namedOwner || OPERATOR_ID,
        ...(targetState || firstWorkflowName
          ? {
              blueprint: {
                ...(targetState ? { targetState } : {}),
                ...(firstWorkflowName
                  ? {
                      firstWorkflow: {
                        name: firstWorkflowName,
                        inputs: ['qualified_lead_or_request', 'tenant_context'],
                        outputs: ['recorded_action', 'exception_or_handoff', 'cost_units'],
                      },
                    }
                  : {}),
              },
            }
          : {}),
      });
      setCase(res.case);
      if (res.case.blueprint?.targetState) {
        setTargetState(String(res.case.blueprint.targetState));
      }
    } catch (err: unknown) {
      setError(
        err instanceof RuntimeHttpError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Blueprint draft failed',
      );
    } finally {
      setBusy(false);
    }
  }

  async function approveBlueprint() {
    setBusy(true);
    setError(null);
    try {
      const res = await RuntimeApi.approveImplementationBlueprint(tenantId, caseId, {
        approvedBy: OPERATOR_ID,
      });
      setCase(res.case);
    } catch (err: unknown) {
      setError(
        err instanceof RuntimeHttpError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Approve failed',
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Shell>
    );
  }

  if (!c) {
    return (
      <Shell>
        <p className="text-sm text-destructive font-mono">{error ?? 'Not found'}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/implementations">Back</Link>
        </Button>
      </Shell>
    );
  }

  const canIntake =
    c.deliveryStatus === 'draft' || c.deliveryStatus === 'on_hold';
  const canBlueprint =
    c.deliveryStatus === 'recommendation_ready' ||
    c.deliveryStatus === 'blueprint_draft';
  const canApprove = c.deliveryStatus === 'blueprint_draft';

  return (
    <Shell>
      <div className="mb-6 flex flex-col gap-2">
        <Link
          to="/implementations"
          className="text-xs text-muted-foreground hover:text-foreground w-fit"
        >
          ← Implementations
        </Link>
        <h1 className="font-display text-3xl tracking-tight">{c.clientName}</h1>
        <p className="text-xs font-mono text-muted-foreground">{c.caseId}</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <span>
            commercial <span className="font-mono">{c.commercialStatus}</span>
          </span>
          <span>
            delivery <span className="font-mono">{c.deliveryStatus}</span>
          </span>
          <span className="text-muted-foreground">owner {c.ownerId}</span>
        </div>
        {c.nextAction && (
          <p className="text-sm">
            <span className="text-muted-foreground">Next: </span>
            {c.nextAction}
          </p>
        )}
        {(c.blockers?.length ?? 0) > 0 && (
          <p className="text-sm text-warn font-mono">
            blockers: {c.blockers!.join(', ')}
          </p>
        )}
        {error && <p className="text-sm text-destructive font-mono">{error}</p>}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-4">
          <h2 className="font-display text-xl">1. Intake</h2>
          <form onSubmit={submitIntake} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ctx">Business context</Label>
              <textarea
                id="ctx"
                className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={businessContext}
                onChange={(e) => setBusinessContext(e.target.value)}
                required
                disabled={!canIntake}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Primary bottleneck</Label>
              <Select
                value={bottleneck}
                onValueChange={(v) => setBottleneck(v as typeof bottleneck)}
                disabled={!canIntake}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOTTLENECKS.map((b) => (
                    <SelectItem key={b.value} value={b.value}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="problem">Measurable problem</Label>
              <Input
                id="problem"
                value={measurableProblem}
                onChange={(e) => setMeasurableProblem(e.target.value)}
                required
                disabled={!canIntake}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner">Named owner</Label>
              <Input
                id="owner"
                className="font-mono"
                value={namedOwner}
                onChange={(e) => setNamedOwner(e.target.value)}
                required
                disabled={!canIntake}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="baseline">Baseline metric (optional)</Label>
              <Input
                id="baseline"
                value={baselineMetric}
                onChange={(e) => setBaselineMetric(e.target.value)}
                disabled={!canIntake}
              />
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={accessReady}
                  onChange={(e) => setAccessReady(e.target.checked)}
                  disabled={!canIntake}
                />
                Access ready
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={approvedScope}
                  onChange={(e) => setApprovedScope(e.target.checked)}
                  disabled={!canIntake}
                />
                Approved scope
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={capacityOk}
                  onChange={(e) => setCapacityOk(e.target.checked)}
                  disabled={!canIntake}
                />
                Delivery capacity OK
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={needsDiscovery}
                  onChange={(e) => setNeedsDiscovery(e.target.checked)}
                  disabled={!canIntake}
                />
                Needs discovery
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={outOfScope}
                  onChange={(e) => setOutOfScope(e.target.checked)}
                  disabled={!canIntake}
                />
                Out of scope
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Model access is recorded as pending and does not block package selection.
            </p>
            {canIntake && (
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Complete intake + qualify'}
              </Button>
            )}
          </form>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl">2. Package recommendation</h2>
          {!c.recommendation ? (
            <p className="text-sm text-muted-foreground">Complete intake to generate.</p>
          ) : (
            <div className="space-y-2 text-sm border border-border/60 rounded-md p-4">
              <div>
                outcome{' '}
                <span className="font-mono">{c.recommendation.outcome}</span>
              </div>
              {c.recommendation.recommendedPackage && (
                <div>
                  package{' '}
                  <span className="font-mono">
                    {c.recommendation.recommendedPackage}
                  </span>
                </div>
              )}
              <p className="text-muted-foreground whitespace-pre-wrap">
                {c.recommendation.rationale}
              </p>
              {(c.recommendation.exclusions?.length ?? 0) > 0 && (
                <ul className="list-disc pl-5 text-muted-foreground">
                  {c.recommendation.exclusions!.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Human review required — generator drafts; accountable person approves
                the blueprint.
              </p>
            </div>
          )}

          <h2 className="font-display text-xl pt-4">3. Blueprint</h2>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="target">Target state (edit before draft)</Label>
              <textarea
                id="target"
                className="flex min-h-[56px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={targetState}
                onChange={(e) => setTargetState(e.target.value)}
                disabled={!canBlueprint && !canApprove}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf">First workflow name</Label>
              <Input
                id="wf"
                value={firstWorkflowName}
                onChange={(e) => setFirstWorkflowName(e.target.value)}
                disabled={!canBlueprint && !canApprove}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {canBlueprint && (
                <Button type="button" onClick={draftBlueprint} disabled={busy}>
                  {c.blueprint ? 'Re-draft blueprint' : 'Draft blueprint'}
                </Button>
              )}
              {canApprove && (
                <Button type="button" onClick={approveBlueprint} disabled={busy}>
                  Approve blueprint
                </Button>
              )}
            </div>
            {c.blueprint && (
              <div className="text-sm border border-border/60 rounded-md p-4 space-y-1 font-mono text-xs">
                <div>
                  v{String(c.blueprint.version)} · {String(c.blueprint.status)} ·{' '}
                  {String(c.blueprint.packageKey)}
                </div>
                {c.blueprint.approvedBy && (
                  <div>
                    approved by {c.blueprint.approvedBy} at {c.blueprint.approvedAt}
                  </div>
                )}
                <div className="text-muted-foreground whitespace-pre-wrap font-sans text-sm pt-2">
                  {String(c.blueprint.currentState ?? '')}
                  {' → '}
                  {String(c.blueprint.targetState ?? '')}
                </div>
              </div>
            )}
          </div>

          <h2 className="font-display text-xl pt-4">Provisioning (visible gates)</h2>
          <ul className="text-sm space-y-1.5">
            {(c.provisioning?.steps ?? []).map((s) => (
              <li key={s.key} className="flex gap-2">
                <span className="font-mono w-40 shrink-0">{s.key}</span>
                <span className="font-mono">{s.status}</span>
                {s.blockReason && (
                  <span className="text-muted-foreground truncate">{s.blockReason}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Shell>
  );
}
