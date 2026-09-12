import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Briefcase, LayoutDashboard, ListChecks, Menu, Plus, ShieldAlert, Target, X } from 'lucide-react';
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
  const [mobileOpen, setMobileOpen] = useState(false);

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground',
      isActive && 'bg-secondary text-foreground',
    );

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
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="md:hidden"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              onClick={() => setMobileOpen((o) => !o)}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              <span className="sr-only">Menu</span>
            </Button>
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

      {mobileOpen && (
        <nav
          id="mobile-nav"
          className="border-b border-border/80 bg-background/95 px-4 py-3 md:hidden"
          aria-label="Primary"
        >
          <div className="flex flex-col gap-1 text-sm">
            <NavLink to="/" end className={navClass} onClick={() => setMobileOpen(false)}>
              <LayoutDashboard className="h-3.5 w-3.5" />
              Command
            </NavLink>
            <NavLink to="/ol001" className={navClass} onClick={() => setMobileOpen(false)}>
              <Target className="h-3.5 w-3.5" />
              OL-001
            </NavLink>
            <NavLink to="/implementations" className={navClass} onClick={() => setMobileOpen(false)}>
              <Briefcase className="h-3.5 w-3.5" />
              IE-001
            </NavLink>
            <NavLink to="/missions" end className={navClass} onClick={() => setMobileOpen(false)}>
              <ListChecks className="h-3.5 w-3.5" />
              Missions
            </NavLink>
            <NavLink
              to="/missions/new"
              className={navClass}
              onClick={() => setMobileOpen(false)}
            >
              <Plus className="h-3.5 w-3.5" />
              New Mission
            </NavLink>
          </div>
        </nav>
      )}
      <main className="flex-1 container py-6 md:py-8">{children}</main>

      <nav
        className="sticky bottom-0 z-20 grid grid-cols-4 border-t border-border/70 bg-background/90 backdrop-blur-md md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Quick nav"
      >
        {[
          { to: '/', label: 'Command', Icon: LayoutDashboard, end: true },
          { to: '/ol001', label: 'OL-001', Icon: Target, end: false },
          { to: '/missions', label: 'Missions', Icon: ListChecks, end: true },
          { to: '/missions/new', label: 'Launch', Icon: Plus, end: false },
        ].map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 py-2.5 text-[10px] uppercase tracking-wide',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
