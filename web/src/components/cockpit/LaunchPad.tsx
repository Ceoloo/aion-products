import { useEffect, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Bot, Handshake, Sparkles, TriangleAlert, Zap } from 'lucide-react';
import { AionApi, type ReadinessReport, type SchemaInfo } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type AssistMode = 'assist' | 'autopilot';

export function LaunchPad({
  schemas,
  onStart,
}: {
  schemas: SchemaInfo[];
  onStart: (body: Record<string, unknown>) => void;
}) {
  const [industry, setIndustry] = useState('funding');
  const [mode, setMode] = useState<AssistMode>('assist');
  const [f, setF] = useState({
    prospectName: '',
    role: '',
    company: '',
    companyIndustry: '',
    offerSummary: '',
    priorObjections: '',
    outstandingQuestions: '',
  });
  const schema = schemas.find((s) => s.key === industry);
  const [stageNow, setStageNow] = useState('');
  const [stageNext, setStageNext] = useState('');

  useEffect(() => {
    if (schema) {
      setStageNow(schema.stages[0]?.id ?? '');
      setStageNext(schema.stages.find((s) => s.meaningful)?.id ?? schema.stages[1]?.id ?? '');
    }
  }, [industry, schemas.length, schema]);

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  const canLaunch = f.prospectName.trim().length > 0;

  return (
    <div className="room-enter grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="panel overflow-hidden">
        <div className="jarvis-glow border-b border-border/60 px-6 py-7 md:px-8 md:py-9">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Engage</p>
          <h1 className="mt-2 max-w-xl font-display text-3xl font-bold leading-[1.1] text-balance md:text-4xl">
            Walk the sale with your copilot — or let it drive the next move.
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground md:text-base">
            GoHighLevel owns the CRM. Revenue Copilot is the live sales IDE: listen, guide, advance the ladder, and hand outcomes back into the AION pipeline.
          </p>
        </div>

        <div className="space-y-5 px-6 py-6 md:px-8">
          <ReadinessStrip />

          <div className="grid gap-3 sm:grid-cols-2">
            <ModeCard
              active={mode === 'assist'}
              icon={Handshake}
              title="Assist me"
              body="Jarvis-style guidance every turn. You stay on the mic; Copilot feeds the next move."
              onClick={() => setMode('assist')}
            />
            <ModeCard
              active={mode === 'autopilot'}
              icon={Bot}
              title="Autopilot intent"
              body="Copilot prioritizes advancing the ladder and staging pipeline moves for GHL / AION."
              onClick={() => setMode('autopilot')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Playbook">
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {schemas.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Offer in one line">
              <Input value={f.offerSummary} onChange={set('offerSummary')} placeholder="Working capital for inventory…" />
            </Field>
            <Field label="Lead name">
              <Input value={f.prospectName} onChange={set('prospectName')} placeholder="Marcus Rivera" />
            </Field>
            <Field label="Role">
              <Input value={f.role} onChange={set('role')} placeholder="Owner" />
            </Field>
            <Field label="Company">
              <Input value={f.company} onChange={set('company')} placeholder="Rivera's Auto Parts" />
            </Field>
            <Field label="Vertical">
              <Input value={f.companyIndustry} onChange={set('companyIndustry')} placeholder="auto parts retail" />
            </Field>
            <Field label="Where they are now">
              <Select value={stageNow} onValueChange={setStageNow}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {schema?.stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}{s.meaningful ? ' · conversion' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Where we want them">
              <Select value={stageNext} onValueChange={setStageNext}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {schema?.stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}{s.meaningful ? ' · conversion' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground transition hover:text-foreground">
              Prior objections & open questions
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Objections already heard">
                <Textarea value={f.priorObjections} onChange={set('priorObjections')} rows={3} placeholder="One per line" />
              </Field>
              <Field label="Still need to learn">
                <Textarea value={f.outstandingQuestions} onChange={set('outstandingQuestions')} rows={3} placeholder="One per line" />
              </Field>
            </div>
          </details>

          <Button
            size="lg"
            className="h-12 w-full text-base font-semibold"
            disabled={!canLaunch}
            onClick={() =>
              onStart({
                industry,
                ...f,
                conversionStageId: stageNow,
                desiredNextStageId: stageNext,
                assistMode: mode,
              })
            }
          >
            <Zap className="mr-2 h-4 w-4" />
            {mode === 'assist' ? 'Enter cockpit' : 'Enter cockpit · autopilot intent'}
          </Button>
          {!canLaunch && (
            <p className="text-center text-xs text-muted-foreground">Name the lead to launch.</p>
          )}
        </div>
      </section>

      <aside className="space-y-4">
        <div className="panel p-6">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">How this works</span>
          </div>
          <ol className="mt-4 space-y-4 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">1. Launch</span>
              <p className="mt-1">Pull context from the lead. GHL remains system of record for contacts & pipeline fields.</p>
            </li>
            <li>
              <span className="font-medium text-foreground">2. Cockpit</span>
              <p className="mt-1">Talk or paste turns. Copilot streams next-best-action, objections, and ladder movement like a live IDE.</p>
            </li>
            <li>
              <span className="font-medium text-foreground">3. Debrief</span>
              <p className="mt-1">Confirm what actually happened in 30–60s — that truth trains the system and unlocks downstream moves.</p>
            </li>
            <li>
              <span className="font-medium text-foreground">4. Control room</span>
              <p className="mt-1">Mission gates, conversion advances, and the session log that proves Revenue Copilot is moving deals.</p>
            </li>
          </ol>
        </div>

        {schema && (
          <div className="panel p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Conversion ladder</div>
            <div className="ladder-track mt-4">
              {schema.stages.map((s, i) => (
                <div
                  key={s.id}
                  className={cn(
                    'ladder-step',
                    s.id === stageNow && 'is-current',
                    i < schema.stages.findIndex((x) => x.id === stageNow) && 'is-done',
                  )}
                  title={s.label}
                >
                  {s.label}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Target: <span className="text-foreground">{schema.stages.find((s) => s.id === stageNext)?.label ?? '—'}</span>
              {schema.conversionEventNoun ? ` · ${schema.conversionEventNoun}` : ''}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function ModeCard({
  active,
  icon: Icon,
  title,
  body,
  onClick,
}: {
  active: boolean;
  icon: typeof Handshake;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border p-4 text-left transition-all',
        active
          ? 'border-primary/50 bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]'
          : 'border-border/70 bg-background/30 hover:border-border hover:bg-secondary/40',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} />
        <span className="font-display font-semibold">{title}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </button>
  );
}

function ReadinessStrip() {
  const [r, setR] = useState<ReadinessReport | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    AionApi.health().then(setR).catch(() => setErr(true));
  }, []);
  if (err || !r) return null;

  const blockers = r.checks.filter((c) => c.level === 'blocker');
  const warns = r.checks.filter((c) => c.level === 'warn');
  const tone = blockers.length
    ? 'border-destructive/40 bg-destructive/10 text-destructive'
    : warns.length
      ? 'border-warn/35 bg-warn/10 text-warn'
      : 'border-ok/35 bg-ok/10 text-ok';

  return (
    <div className={cn('rounded-xl border px-3 py-2.5 text-sm', tone)}>
      <button type="button" className="flex w-full items-center gap-2 text-left font-medium" onClick={() => setOpen((o) => !o)}>
        {blockers.length ? <TriangleAlert className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        <span>
          {blockers.length
            ? `Systems not ready — ${blockers.length} blocker${blockers.length > 1 ? 's' : ''}`
            : `Systems ready · ${r.aiPath === 'claude' ? 'Claude' : 'deterministic'} path`}
        </span>
        <span className="ml-auto text-[11px] opacity-70">{open ? 'Hide' : 'Details'}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 border-t border-current/15 pt-2">
          {r.checks.map((c) => (
            <li key={c.id} className="text-xs text-foreground/90">
              <span className="font-medium">{c.title}.</span>{' '}
              <span className="opacity-75">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
