import type { PropsWithChildren } from 'react';
import { cn } from '@/lib/utils';
import { Crosshair, Headphones, LayoutDashboard, Rocket } from 'lucide-react';

export type Room = 'launch' | 'live' | 'debrief' | 'control';

const ROOMS: Array<{ id: Room; label: string; hint: string; Icon: typeof Rocket; needsLive?: boolean }> = [
  { id: 'launch', label: 'Launch', hint: 'Engage a lead', Icon: Rocket },
  { id: 'live', label: 'Cockpit', hint: 'Live guidance', Icon: Headphones, needsLive: true },
  { id: 'debrief', label: 'Debrief', hint: 'Lock the truth', Icon: Crosshair, needsLive: true },
  { id: 'control', label: 'Control', hint: 'Mission room', Icon: LayoutDashboard },
];

export function CockpitShell({
  room,
  onNav,
  live,
  leadName,
  children,
  toast,
}: PropsWithChildren<{
  room: Room;
  onNav: (r: Room) => void;
  live: boolean;
  leadName?: string;
  toast?: string | null;
}>) {
  return (
    <div className="relative flex min-h-full flex-col">
      <div className="pointer-events-none absolute inset-0 cockpit-grid" aria-hidden />

      <header className="relative z-20 border-b border-border/70 bg-background/50 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-4 px-4 py-3 md:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <span className="font-display text-sm font-bold">A</span>
              </div>
              <div className="min-w-0">
                <div className="font-display text-base font-bold leading-none tracking-tight md:text-lg">
                  Revenue Copilot
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  Sales cockpit · CRM stays in GoHighLevel
                </div>
              </div>
            </div>
          </div>

          <nav className="ml-auto hidden items-center gap-1 rounded-full border border-border/70 bg-card/50 p-1 md:flex">
            {ROOMS.map(({ id, label, Icon, needsLive }) => {
              const disabled = !!needsLive && !live;
              const active = room === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onNav(id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-all',
                    active && 'bg-primary text-primary-foreground shadow-sm',
                    !active && !disabled && 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    disabled && 'cursor-not-allowed opacity-35',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            {live ? (
              <span className="signal-live">Live{leadName ? ` · ${leadName}` : ''}</span>
            ) : (
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Standby</span>
            )}
          </div>
        </div>
      </header>

      {toast && (
        <div className="relative z-20 mx-auto w-full max-w-[1600px] px-4 pt-3 md:px-6">
          <div className="rounded-xl border border-warn/35 bg-warn/10 px-4 py-2.5 text-sm text-warn animate-fade-up">
            {toast}
          </div>
        </div>
      )}

      <main className="relative z-10 mx-auto w-full max-w-[1600px] flex-1 px-4 py-4 md:px-6 md:py-6">
        {children}
      </main>

      <nav
        className="sticky bottom-0 z-20 grid grid-cols-4 border-t border-border/70 bg-background/90 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom,0px)' }}
      >
        {ROOMS.map(({ id, label, Icon, needsLive }) => {
          const disabled = !!needsLive && !live;
          const active = room === id;
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onNav(id)}
              className={cn(
                'flex flex-col items-center gap-1 py-2.5 text-[10px] uppercase tracking-wide',
                active ? 'text-primary' : 'text-muted-foreground',
                disabled && 'opacity-35',
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
