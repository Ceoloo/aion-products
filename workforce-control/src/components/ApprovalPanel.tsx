import { X } from 'lucide-react';
import type { ApprovalRequest } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';

/**
 * Inspect-only approval queue.
 * Decide remains a Runtime POST — link note only (no broad write cockpit).
 */
export function ApprovalPanel({
  open,
  onClose,
  approvals,
  loading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  approvals: ApprovalRequest[];
  loading: boolean;
  error: string | null;
}) {
  if (!open) return null;

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
              Inspect-only · decide via Runtime POST /v1/approvals/:id/decision
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Loading approvals…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
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
                    <Link className="text-primary underline-offset-2 hover:underline" to={`/missions/${a.missionId}`}>
                      {a.missionId}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Execution</dt>
                <dd className="truncate">
                  {a.executionId ? (
                    <Link className="text-primary underline-offset-2 hover:underline" to={`/executions/${a.executionId}`}>
                      {a.executionId}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Requested</dt>
                <dd className="font-mono">{a.requestedAt ?? '—'}</dd>
              </dl>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}
