import { ArrowRight, Crosshair, Headphones, Mic, Rocket, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Standby view when Cockpit tab is open but no live engagement exists. */
export function CockpitStandby({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="room-enter grid h-[calc(100dvh-8.5rem)] gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
      <section className="panel relative flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 md:px-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Channel · standby
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">No live engagement — open Launch to bring a lead into the cockpit.</p>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-live/10 text-live">
            <Headphones className="h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-bold md:text-3xl">Cockpit is clear</h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            This is your live sales channel — ChatGPT-style conversation on the left, Atlas guidance on the right.
            Engage a lead to start streaming turns and next moves.
          </p>
          <Button className="mt-6 h-11 px-6 font-semibold" onClick={onLaunch}>
            <Rocket className="mr-2 h-4 w-4" /> Go to Launch
          </Button>

          <div className="mt-10 grid w-full max-w-lg gap-2 text-left sm:grid-cols-3">
            {[
              { Icon: Mic, t: 'Talk or paste', d: 'Turns stream in live' },
              { Icon: Sparkles, t: 'Atlas rail', d: 'Next move + deal radar' },
              { Icon: ArrowRight, t: 'Advance', d: 'Push the ladder forward' },
            ].map(({ Icon, t, d }) => (
              <div key={t} className="panel-inset px-3 py-3">
                <Icon className="mb-2 h-4 w-4 text-primary" />
                <div className="text-sm font-medium">{t}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="panel flex min-h-0 flex-col overflow-hidden atlas-glow">
        <div className="border-b border-border/60 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Atlas rail</div>
          <p className="mt-1 text-sm text-muted-foreground">Next move & deal radar appear when you are live.</p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <div className="rounded-2xl border border-dashed border-border/70 px-5 py-8">
            <p className="font-display text-base font-semibold">Waiting for signal</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Once a call is live, Copilot posts the next utterance and ladders the deal here.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Standby view when Debrief tab is open but there is nothing to lock yet. */
export function DebriefStandby({
  hasLiveSession,
  onCockpit,
  onLaunch,
}: {
  hasLiveSession: boolean;
  onCockpit: () => void;
  onLaunch: () => void;
}) {
  return (
    <div className="room-enter mx-auto max-w-3xl">
      <section className="panel overflow-hidden">
        <div className="atlas-glow border-b border-border/60 px-6 py-8 md:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Debrief</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Truth lock · pipeline move</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            After a call, spend 30–60 seconds confirming what actually happened — upstream advances, downstream
            conversions, and corrections that train Copilot. CRM fields still land in GoHighLevel.
          </p>
        </div>

        <div className="flex flex-col items-center px-6 py-12 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Crosshair className="h-6 w-6" />
          </div>
          {hasLiveSession ? (
            <>
              <p className="font-display text-xl font-semibold">Engagement still live</p>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                End the call from the Cockpit to open debrief with the AI’s read ready for your corrections.
              </p>
              <Button className="mt-6 h-11 px-6 font-semibold" onClick={onCockpit}>
                <Headphones className="mr-2 h-4 w-4" /> Return to Cockpit
              </Button>
            </>
          ) : (
            <>
              <p className="font-display text-xl font-semibold">Nothing to debrief yet</p>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Launch an engagement, run the cockpit, then lock outcome and ladder movement here before Control Room.
              </p>
              <Button className="mt-6 h-11 px-6 font-semibold" onClick={onLaunch}>
                <Rocket className="mr-2 h-4 w-4" /> Go to Launch
              </Button>
            </>
          )}

          <div className="mt-10 grid w-full max-w-lg gap-3 text-left sm:grid-cols-2">
            <div className="panel-inset p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Upstream</div>
              <p className="mt-1 text-sm">Did the deal advance a conversion stage?</p>
            </div>
            <div className="panel-inset p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Downstream</div>
              <p className="mt-1 text-sm">Application, appointment, proposal, close…</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
