import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Ban, Check, Pencil, X } from 'lucide-react';
import type { DealState, Turn } from '@/lib/api';
import { DISPOSITIONS, DOWNSTREAM, OUTCOMES, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

const GT_FIELDS: Array<{ key: string; label: string; get: (s: DealState) => string }> = [
  { key: 'pain', label: 'Pain', get: (s) => s.facts.pain?.value ?? '—' },
  { key: 'urgency', label: 'Urgency', get: (s) => s.urgency },
  { key: 'authority', label: 'Authority', get: (s) => s.facts.decision_authority?.value ?? '—' },
  { key: 'objection', label: 'Objection', get: (s) => s.objections.map((o) => o.category).join(', ') || 'none' },
  { key: 'conversation_stage', label: 'Stage read', get: (s) => s.conversationStage },
  { key: 'buying_signals', label: 'Buying signals', get: (s) => `${s.buyingSignals.length} detected` },
];

export function Debrief({
  state,
  transcript,
  leadName,
  onSave,
}: {
  state: DealState;
  transcript: Turn[];
  leadName?: string;
  onSave: (gt: unknown) => void;
}) {
  const [verdicts, setVerdicts] = useState<Record<string, { verdict: string; corrected?: string }>>({});
  const [guidance, setGuidance] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');
  const [disposition, setDisposition] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [downstream, setDownstream] = useState('');
  const suggestEval = useMemo(() => {
    const pt = transcript.filter((t) => t.speaker === 'prospect');
    return pt.length >= 2 && pt.reduce((n, t) => n + t.text.split(/\s+/).length, 0) >= 40;
  }, [transcript]);
  const [evaluable, setEvaluable] = useState(suggestEval);
  const [notes, setNotes] = useState('');

  const setV = (k: string, verdict: string) =>
    setVerdicts((m) => ({ ...m, [k]: { verdict, corrected: m[k]?.corrected } }));

  const judged = Object.keys(verdicts).length;
  const ready = !!outcome && !!disposition;

  return (
    <div className="room-enter mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_0.9fr]">
      <section className="panel overflow-hidden">
        <div className="border-b border-border/60 px-6 py-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Debrief · 30–60s</p>
          <h1 className="mt-1 font-display text-2xl font-bold md:text-3xl">
            {leadName ? `Lock truth · ${leadName}` : 'Confirm what actually happened'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your corrections are ground truth — they train Copilot and unlock pipeline movement. CRM writes still land in GoHighLevel.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-border/70 bg-background/40 px-2.5 py-1">
              Stage · <span className="text-foreground">{state.conversationStage}</span>
            </span>
            <span className="rounded-full border border-border/70 bg-background/40 px-2.5 py-1">
              Urgency · <span className="text-foreground">{state.urgency}</span>
            </span>
            <span className="rounded-full border border-border/70 bg-background/40 px-2.5 py-1">
              Readiness · <span className="text-foreground">{state.readiness.level}</span>
            </span>
            <span className="rounded-full border border-border/70 bg-background/40 px-2.5 py-1 font-mono">
              {judged}/{GT_FIELDS.length} fields judged
            </span>
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div className="space-y-3">
            {GT_FIELDS.map((fld) => (
              <div key={fld.key} className="panel-inset space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-28 font-medium">{fld.label}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">AI: {fld.get(state)}</span>
                  <div className="flex gap-1">
                    {([['correct', Check], ['incorrect', X], ['edited', Pencil], ['not_applicable', Ban]] as const).map(([v, Icon]) => (
                      <Button
                        key={v}
                        size="icon"
                        variant={verdicts[fld.key]?.verdict === v ? 'default' : 'outline'}
                        className="h-8 w-8 rounded-lg"
                        onClick={() => setV(fld.key, v)}
                        title={titleCase(v)}
                      >
                        <Icon className="h-4 w-4" />
                      </Button>
                    ))}
                  </div>
                </div>
                {verdicts[fld.key]?.verdict === 'edited' && (
                  <Input
                    placeholder="Corrected value"
                    value={verdicts[fld.key]?.corrected ?? ''}
                    onChange={(e) =>
                      setVerdicts((m) => ({ ...m, [fld.key]: { verdict: 'edited', corrected: e.target.value } }))
                    }
                  />
                )}
              </div>
            ))}
          </div>

          <div>
            <Label>Did the guidance help?</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['useful', 'acted_on', 'ignored', 'wrong', 'mixed'].map((g) => (
                <Button
                  key={g}
                  size="sm"
                  variant={guidance === g ? 'default' : 'outline'}
                  className="rounded-full"
                  onClick={() => setGuidance(g)}
                >
                  {titleCase(g)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setAdvanced(true)}
            className={cn(
              'panel p-4 text-left transition',
              advanced && 'border-ok/45 bg-ok/10 shadow-[0_0_0_1px_hsl(var(--ok)/0.2)]',
            )}
          >
            <ArrowUpRight className={cn('h-4 w-4', advanced ? 'text-ok' : 'text-muted-foreground')} />
            <div className="mt-2 font-display font-semibold">Upstream</div>
            <p className="mt-1 text-xs text-muted-foreground">Deal advanced a ladder stage</p>
          </button>
          <button
            type="button"
            onClick={() => setAdvanced(false)}
            className={cn(
              'panel p-4 text-left transition',
              !advanced && 'border-border bg-secondary/30',
            )}
          >
            <ArrowDownRight className="h-4 w-4 text-muted-foreground" />
            <div className="mt-2 font-display font-semibold">No advance</div>
            <p className="mt-1 text-xs text-muted-foreground">Held or stepped sideways</p>
          </button>
        </div>

        <div className="panel space-y-5 p-6">
          <div>
            <h2 className="font-display text-lg font-semibold">Outcome & pipeline</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Mark where the lead should sit so AION / GHL can move them.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <Label>Call outcome <span className="text-destructive">*</span></Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="What happened?" /></SelectTrigger>
                <SelectContent>
                  {OUTCOMES.map((o) => <SelectItem key={o} value={o}>{titleCase(o)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Disposition <span className="text-destructive">*</span></Label>
              <Select value={disposition} onValueChange={setDisposition}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="How did it go?" /></SelectTrigger>
                <SelectContent>
                  {DISPOSITIONS.map((o) => <SelectItem key={o} value={o}>{titleCase(o)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Downstream conversion</Label>
              <Select value={downstream || 'none'} onValueChange={(v) => setDownstream(v === 'none' ? '' : v)}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOWNSTREAM.map((o) => (
                    <SelectItem key={o || 'none'} value={o || 'none'}>{o ? titleCase(o) : 'None yet'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={evaluable} onCheckedChange={(v) => setEvaluable(!!v)} />
            Counts as a real evaluable conversation
          </label>

          <div>
            <Label>Notes for the next touch</Label>
            <Textarea
              className="mt-1.5"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What should Assist / Autopilot remember?"
            />
          </div>

          <Button
            className="h-11 w-full text-base font-semibold"
            size="lg"
            disabled={!ready}
            onClick={() =>
              onSave({
                fields: verdicts,
                guidance,
                outcome,
                disposition,
                advanced,
                downstreamConversion: downstream || null,
                evaluable,
                notes,
              })
            }
          >
            Lock mission outcome
          </Button>
          {!ready && (
            <p className="text-center text-xs text-muted-foreground">Pick outcome and disposition to finish.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
