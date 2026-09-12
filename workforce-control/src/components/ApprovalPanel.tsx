import { useState } from 'react';
import { X } from 'lucide-react';
import type { ApprovalRequest } from '@/lib/types';
import { RuntimeApi, RuntimeHttpError } from '@/lib/runtime-api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';

const DECIDED_BY =
  (import.meta.env.VITE_AION_OPERATOR_ID as string | undefined) ?? 'operator-console';

/** Human actor stamped on every Console approval decision (satisfies actors FK). */
function consoleApproverActor(
  tenantId: string,
  opts?: { productionEconomic?: boolean },
) {
  const productionEconomic = opts?.productionEconomic === true;
  return {
    actorType: 'human' as const,
    actorId: DECIDED_BY,
    name: 'Operator Console Approver',
    email: 'operator-console@aion.local',
    permissions: [
      'crm.opportunity.create',
      'crm.opportunity.update',
      'crm.contact.update',
      'crm.note.create',
      'crm.task.create',
      'crm.message.send',
    ],
    maxRiskLevel: 'R3',
    tenantId,
    companyId: 'co_aion',
    metadata: {
      source: 'operator-console',
      cohort: productionEconomic ? 'OL-001' : 'pre_ol_validation',
      productionEconomic,
    },
  };
}

/**
 * Approval queue — inspect + decide via Runtime POST /v1/approvals/:id/decision.
 * UI is not the authority; every Approve/Deny is a governed capability call.
 */
export function ApprovalPanel({
  open,
  onClose,
  approvals,
  loading,
  error,
  tenantId,
  onDecided,
}: {
  open: boolean;
  onClose: () => void;
  approvals: ApprovalRequest[];
  loading: boolean;
  error: string | null;
  tenantId: string;
  onDecided?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!open) return null;

  async function decide(approval: ApprovalRequest, approve: boolean) {
    setBusyId(approval.approvalId);
    setActionError(null);
    const cmdMeta =
      approval.command &&
      typeof approval.command === 'object' &&
      approval.command !== null &&
      'metadata' in approval.command &&
      typeof (approval.command as { metadata?: unknown }).metadata === 'object'
        ? ((approval.command as { metadata?: Record<string, unknown> }).metadata ??
          {})
        : {};
    const productionEconomic = cmdMeta.productionEconomic === true;
    try {
      await RuntimeApi.decideApproval(tenantId, approval.approvalId, {
        approve,
        decidedBy: DECIDED_BY,
        note: approve
          ? 'approved via Operator Console'
          : 'denied via Operator Console',
        actor: consoleApproverActor(tenantId, { productionEconomic }),
      });
      onDecided?.();
    } catch (err: unknown) {
      const msg =
        err instanceof RuntimeHttpError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'decision failed';
      setActionError(msg);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close approvals"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-xl animate-fade-up">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="font-display text-lg">Approval queue</div>
            <p className="text-xs text-muted-foreground">
              Decide via Runtime · decidedBy={DECIDED_BY}
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Loading approvals…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          {!loading && !error && approvals.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No pending approvals from API for this tenant.
            </p>
          )}
          {approvals.map((a) => (
            <article
              key={a.approvalId}
              className="rounded-md border border-border/80 bg-card/50 px-3 py-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant="warn">{a.status}</Badge>
                <span className="font-mono text-[0.65rem] text-muted-foreground">
                  {a.approvalId}
                </span>
              </div>
              <p className="text-sm">{a.reason ?? '—'}</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt>Risk</dt>
                <dd className="font-mono text-foreground">{a.riskLevel ?? '—'}</dd>
                <dt>Run</dt>
                <dd className="font-mono text-foreground truncate">{a.runId}</dd>
                <dt>Mission</dt>
                <dd className="truncate">
                  {a.missionId ? (
                    <Link
                      className="text-primary underline-offset-2 hover:underline"
                      to={`/missions/${a.missionId}`}
                    >
                      {a.missionId}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Execution</dt>
                <dd className="truncate">
                  {a.executionId ? (
                    <Link
                      className="text-primary underline-offset-2 hover:underline"
                      to={`/executions/${a.executionId}`}
                    >
                      {a.executionId}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Requested</dt>
                <dd className="font-mono">{a.requestedAt ?? '—'}</dd>
              </dl>
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  disabled={busyId === a.approvalId}
                  onClick={() => void decide(a, true)}
                >
                  {busyId === a.approvalId ? '…' : 'Approve'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyId === a.approvalId}
                  onClick={() => void decide(a, false)}
                >
                  Deny
                </Button>
              </div>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}
