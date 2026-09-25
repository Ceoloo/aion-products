import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { useTenant } from '@/hooks/useTenant';
import { RuntimeApi } from '@/lib/runtime-api';
import type { ImplementationCase } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadState } from '@/components/WorkflowState';

/**
 * IE-001 — Implementation case list (tenant-scoped via Runtime).
 * Phase 1 (UX-R3): shared Load / Error / Empty states.
 */
export default function Implementations() {
  const { tenantId } = useTenant();
  const [cases, setCases] = useState<ImplementationCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    RuntimeApi.listImplementations(tenantId)
      .then((res) => {
        if (!cancelled) setCases(res.cases ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCases([]);
          setError(err instanceof Error ? err.message : 'Failed to load cases');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, tick]);

  const attentionCases = cases.filter(
    (c) =>
      (c.blockers?.length ?? 0) > 0 ||
      c.deliveryStatus === 'on_hold' ||
      Boolean(c.nextAction),
  );

  return (
    <Shell>
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-1">
            IE-001
          </p>
          <h1 className="font-display text-3xl tracking-tight">Implementations</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Commercial handoff → intake → package recommendation → approved blueprint.
            GHL and model access stay blocked until verified.
          </p>
        </div>
        <Button asChild size="sm" className="gap-1.5 shrink-0">
          <Link to="/implementations/new">
            <Plus className="h-3.5 w-3.5" />
            New case
          </Link>
        </Button>
      </div>

      {loading && <LoadState label="Loading implementation cases…" />}
      {error && (
        <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} className="mb-4" />
      )}

      {!loading && !error && attentionCases.length > 0 && (
        <section className="mb-6" aria-label="Needs attention">
          <h2 className="font-display text-sm uppercase tracking-[0.18em] text-warn mb-2">
            Needs attention
          </h2>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-md border border-warn/35 bg-warn/5">
            {attentionCases.slice(0, 8).map((c) => (
              <li key={`attn-${c.caseId}`}>
                <Link
                  to={`/implementations/${c.caseId}`}
                  className="flex flex-col gap-1 px-3 py-2.5 hover:bg-accent/30 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.clientName}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {c.nextAction ??
                        ((c.blockers?.length ?? 0) > 0
                          ? `blockers: ${c.blockers!.join(', ')}`
                          : c.deliveryStatus)}
                    </div>
                  </div>
                  <span className="font-mono text-xs shrink-0">{c.deliveryStatus}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && !error && cases.length === 0 ? (
        <EmptyState
          title="No implementation cases yet"
          detail="Create a commercial handoff case to start IE-001 intake."
          actionTo="/implementations/new"
          actionLabel="New case"
        />
      ) : !loading && !error ? (
        <ul className="divide-y divide-border/80 border border-border/60 rounded-md">
          {cases.map((c) => (
            <li key={c.caseId}>
              <Link
                to={`/implementations/${c.caseId}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 hover:bg-secondary/40"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{c.clientName}</div>
                  <div className="text-xs font-mono text-muted-foreground truncate">
                    {c.caseId} · {c.clientRef}
                  </div>
                </div>
                <div className="text-xs sm:text-right shrink-0 space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">commercial </span>
                    <span className="font-mono">{c.commercialStatus}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">delivery </span>
                    <span className="font-mono">{c.deliveryStatus}</span>
                  </div>
                  {c.nextAction && (
                    <div className="text-muted-foreground max-w-xs sm:ml-auto truncate">
                      {c.nextAction}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Shell>
  );
}
