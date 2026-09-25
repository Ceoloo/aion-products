import { useState } from 'react';
import { X } from 'lucide-react';
import type { ApprovalRequest } from '@/lib/types';
import { RuntimeApi, RuntimeHttpError } from '@/lib/runtime-api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';

function proposedAction(command: unknown): { capability: string; name: string; payload: string; actor: string } {
  const c = command && typeof command === 'object' ? command as Record<string, unknown> : {};
  const actor = c.actor && typeof c.actor === 'object' ? c.actor as Record<string, unknown> : {};
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) =>
      [key, /token|secret|password|authorization|api.?key/i.test(key) ? '[redacted]' : redact(item)]));
  };
  return {
    capability: String(c.capability ?? 'unknown capability'),
    name: String(c.name ?? 'Unnamed action'),
    payload: JSON.stringify(redact(c.payload ?? {}), null, 2),
    actor: String(actor.name ?? actor.actorId ?? 'unknown actor'),
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
  const [notes, setNotes] = useState<Record<string, string>>({});

  if (!open) return null;

  async function decide(approval: ApprovalRequest, approve: boolean) {
    setBusyId(approval.approvalId);
    setActionError(null);
    try {
      const result = await RuntimeApi.decideApproval(tenantId, approval.approvalId, {
        approve,
        note: notes[approval.approvalId]?.trim() ||
          (approve ? 'approved via Operator Console' : 'denied via Operator Console'),
      });
      if (result.continuation?.status === 'failed') {
        setActionError('The decision was recorded, but mission continuation failed. Inspect the mission before retrying.');
      }
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
              Decide via Runtime · identity derived from your session
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
              <div className="rounded border border-border/70 bg-background/50 p-2 text-xs space-y-1">
                <p className="font-medium text-foreground">{proposedAction(a.command).name}</p>
                <p>Capability: <span className="font-mono text-foreground">{proposedAction(a.command).capability}</span></p>
                <p>Requested by: <span className="text-foreground">{proposedAction(a.command).actor}</span></p>
                <details>
                  <summary className="cursor-pointer text-primary">Proposed action data</summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-foreground">{proposedAction(a.command).payload}</pre>
                </details>
              </div>
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
              <label className="block text-xs text-muted-foreground">
                Decision note
                <input
                  className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm text-foreground"
                  value={notes[a.approvalId] ?? ''}
                  onChange={(e) => setNotes((current) => ({ ...current, [a.approvalId]: e.target.value }))}
                  placeholder="Reason or evidence for this decision"
                />
              </label>
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
