import { Link, NavLink } from 'react-router-dom';
import { Briefcase, LayoutDashboard, ListChecks, Plus, ShieldAlert, Target } from 'lucide-react';
import { PRESETS, useTenant } from '@/hooks/useTenant';
import { RuntimeApi } from '@/lib/runtime-api';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function Shell({
  children,
  onOpenApprovals,
  pendingCount,
}: {
  children: React.ReactNode;
  onOpenApprovals?: () => void;
  pendingCount?: number;
}) {
  const { tenantId, setTenantId } = useTenant();

  return (
    <div className="min-h-full flex flex-col">
      <header className="relative border-b border-border/80 backdrop-blur-sm">
        <div className="pointer-events-none absolute inset-0 ops-grid opacity-40" />
        <div className="relative container flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <Link to="/" className="font-display text-lg tracking-tight text-foreground shrink-0">
              AION
              <span className="ml-2 text-xs font-sans font-normal uppercase tracking-[0.18em] text-muted-foreground">
                Operator
              </span>
            </Link>
            <nav className="hidden md:flex items-center gap-1 text-sm">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground',
                    isActive && 'bg-secondary text-foreground',
                  )
                }
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Command
              </NavLink>
              <NavLink
                to="/ol001"
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground',
                    isActive && 'bg-secondary text-foreground',
                  )
                }
              >
                <Target className="h-3.5 w-3.5" />
                OL-001
              </NavLink>
              <NavLink
                to="/implementations"
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground',
                    isActive && 'bg-secondary text-foreground',
                  )
                }
              >
                <Briefcase className="h-3.5 w-3.5" />
                IE-001
              </NavLink>
              <NavLink
                to="/missions"
                end
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground',
                    isActive && 'bg-secondary text-foreground',
                  )
                }
              >
                <ListChecks className="h-3.5 w-3.5" />
                Missions
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button asChild size="sm" className="gap-1.5 hidden sm:inline-flex">
              <Link to="/missions/new">
                <Plus className="h-3.5 w-3.5" />
                New Mission
              </Link>
            </Button>
            <label className="sr-only" htmlFor="tenant">
              Tenant
            </label>
            <Input
              id="tenant"
              list="tenant-presets"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value.trim())}
              className="h-8 w-36 font-mono text-xs"
              title={`x-aion-tenant-id → ${RuntimeApi.runtimeUrl}`}
            />
            <datalist id="tenant-presets">
              {PRESETS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            {onOpenApprovals && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={onOpenApprovals}
              >
                <ShieldAlert className="h-3.5 w-3.5 text-warn" />
                Approvals
                {typeof pendingCount === 'number' && (
                  <span className="font-mono text-xs text-warn">{pendingCount}</span>
                )}
              </Button>
            )}
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-primary/70 to-transparent animate-scan" />
        </div>
      </header>
      <main className="flex-1 container py-6 md:py-8">{children}</main>
    </div>
  );
}
