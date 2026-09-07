import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * Interactive drill target for a canonical metric.
 * Cards are used only for these interactive drill targets — not decoration.
 */
export function MetricLink({
  label,
  value,
  to,
  hint,
  tone = 'default',
  className,
}: {
  label: string;
  value: string | number | null | undefined;
  to?: string;
  hint?: string;
  tone?: 'default' | 'ok' | 'warn' | 'danger';
  className?: string;
}) {
  const display =
    value === null || value === undefined || value === ''
      ? '—'
      : typeof value === 'number'
        ? Number.isInteger(value)
          ? String(value)
          : value.toFixed(2)
        : value;

  const toneClass =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'danger'
          ? 'text-destructive'
          : 'text-foreground';

  const body = (
    <>
      <div className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={cn('mt-1 font-display text-2xl tabular-nums tracking-tight', toneClass)}>
        {display}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </>
  );

  const base =
    'block text-left rounded-md border border-border/80 bg-card/60 px-3.5 py-3 transition-colors';

  if (!to) {
    return <div className={cn(base, 'opacity-90', className)}>{body}</div>;
  }

  return (
    <Link
      to={to}
      className={cn(base, 'hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      {body}
    </Link>
  );
}
