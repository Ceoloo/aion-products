import { Link } from 'react-router-dom';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Canonical loading line — pulse only, no fake skeleton KPIs. */
export function LoadState({ label = 'Loading…' }: { label?: string }) {
  return (
    <p
      className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground animate-pulse-soft"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      {label}
    </p>
  );
}

/** Actionable error — always show the Runtime/API message, never hide it. */
export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive',
        className,
      )}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Could not load system state</p>
          <p className="mt-0.5 break-words text-destructive/90">{message}</p>
          {onRetry && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 border-destructive/40"
              onClick={onRetry}
            >
              Retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Empty state with optional next action — never invent filler metrics. */
export function EmptyState({
  title,
  detail,
  actionTo,
  actionLabel,
}: {
  title: string;
  detail?: string;
  actionTo?: string;
  actionLabel?: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-border/80 bg-card/30 px-4 py-6 text-center">
      <Inbox className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
      <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      {actionTo && actionLabel && (
        <Button asChild size="sm" className="mt-3">
          <Link to={actionTo}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}

export type AttentionItem = {
  id: string;
  kind: 'approval' | 'failure' | 'exception';
  label: string;
  detail?: string;
  to?: string;
  onAct?: () => void;
  actLabel?: string;
};

/**
 * Attention rail — answers “what needs my decision?” before decorative metrics.
 * Only renders when there is real work from Runtime.
 */
export function AttentionRail({
  items,
  loading,
}: {
  items: AttentionItem[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <section className="mb-10 animate-fade-up" aria-busy="true">
        <h2 className="mb-3 font-display text-sm uppercase tracking-[0.18em] text-muted-foreground">
          Needs attention
        </h2>
        <LoadState label="Checking approvals and failures…" />
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="mb-10 animate-fade-up">
        <h2 className="mb-3 font-display text-sm uppercase tracking-[0.18em] text-muted-foreground">
          Needs attention
        </h2>
        <p className="text-sm text-muted-foreground">
          Nothing queued — no pending approvals or failed executions for this tenant.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-10 animate-fade-up" aria-label="Needs attention">
      <div className="mb-3 flex items-end justify-between gap-2">
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-warn">
          Needs attention
        </h2>
        <span className="font-mono text-xs text-warn">{items.length}</span>
      </div>
      <ul className="divide-y divide-border/70 overflow-hidden rounded-md border border-warn/35 bg-warn/5">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                {item.kind}
              </div>
              {item.to ? (
                <Link
                  to={item.to}
                  className="block truncate font-medium text-foreground hover:text-primary"
                >
                  {item.label}
                </Link>
              ) : (
                <div className="truncate font-medium text-foreground">{item.label}</div>
              )}
              {item.detail && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.detail}</p>
              )}
            </div>
            {item.onAct && item.actLabel && (
              <Button type="button" size="sm" variant="outline" onClick={item.onAct}>
                {item.actLabel}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
