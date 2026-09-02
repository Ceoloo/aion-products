import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Headphones, ClipboardList, BarChart3, ClipboardEdit, Mic, Square, Send, PhoneOff,
  RotateCcw, Check, X, Pencil, Ban, Sparkles, TriangleAlert, User, UserRound,
} from 'lucide-react';
import { AionApi, type DealState, type Recommendation, type SchemaInfo, type Turn, type DashboardMetrics, type DashboardRecord, type GateStatus } from '@/lib/api';
import { useMic } from '@/hooks/useMic';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';

type Screen = 'setup' | 'live' | 'validate' | 'dashboard';
type PinRole = 'auto' | 'rep' | 'prospect';

const GT_FIELDS: Array<{ key: string; label: string; get: (s: DealState) => string }> = [
  { key: 'pain', label: 'Pain', get: (s) => s.facts.pain?.value ?? '—' },
  { key: 'urgency', label: 'Urgency', get: (s) => s.urgency },
  { key: 'authority', label: 'Authority', get: (s) => s.facts.decision_authority?.value ?? '—' },
  { key: 'objection', label: 'Objection', get: (s) => s.objections.map((o) => o.category).join(', ') || 'none' },
  { key: 'conversation_stage', label: 'Conversation stage', get: (s) => s.conversationStage },
  { key: 'buying_signals', label: 'Buying signals', get: (s) => `${s.buyingSignals.length} detected` },
];

const OUTCOMES = ['no_contact', 'engaged', 'qualified', 'follow_up', 'application', 'appointment', 'proposal', 'demo', 'other_conversion', 'closed', 'disqualified'];
const DISPOSITIONS = ['conversation', 'gatekeeper', 'instant_rejection', 'bad_timing', 'existing_provider', 'rate_first', 'callback', 'no_contact', 'other'];
const DOWNSTREAM = ['', 'application', 'appointment', 'proposal', 'demo', 'closed', 'other_conversion'];

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [briefing, setBriefing] = useState('');
  const [aiPath, setAiPath] = useState('');
  const [state, setState] = useState<DealState | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [fb, setFb] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { AionApi.schemas().then((d) => setSchemas(d.schemas)).catch((e) => setToast(e.message)); }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); } }, [toast]);

  const refresh = async (id: string) => {
    const d = await AionApi.state(id);
    setState(d.state); setTranscript(d.transcript);
  };

  // Serialize ingest requests: rapid mic finals must apply in order, so each
  // enqueues after the previous settles. A failed turn toasts but doesn't break
  // the chain, so later turns still process.
  const ingestChain = useRef<Promise<void>>(Promise.resolve());

  // Leaving an active session for Setup would orphan it server-side (it stays
  // live, unfinalized) and start a second one. Confirm before abandoning it.
  const navGuard = (target: Screen) => {
    if (sessionId && target === 'setup' && screen !== 'setup') {
      if (!window.confirm('Start a new call? The current session is still open and will be abandoned (not saved).')) return;
    }
    setScreen(target);
  };

  return (
    <div className="min-h-full flex flex-col">
      <Header screen={screen} onNav={navGuard} live={!!sessionId} />
      {toast && (
        <div className="mx-auto mt-3 w-full max-w-6xl px-4">
          <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{toast}</div>
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">
        {screen === 'setup' && (
          <SetupView
            schemas={schemas}
            onStart={async (body) => {
              try {
                const d = await AionApi.createSession(body);
                setSessionId(d.sessionId); setBriefing(d.briefing); setAiPath(d.aiPath);
                setState(null); setRecs([]); setTranscript([]); setFb({});
                setScreen('live');
              } catch (e: any) { setToast(e.message); }
            }}
          />
        )}
        {screen === 'live' && sessionId && (
          <LiveView
            sessionId={sessionId} briefing={briefing} aiPath={aiPath}
            state={state} recs={recs} transcript={transcript} fb={fb}
            onIngest={(fn) => {
              ingestChain.current = ingestChain.current.then(async () => {
                try { const r = await fn(); setRecs(r.recommendations); await refresh(sessionId); }
                catch (e: any) { setToast(e.message); }
              });
            }}
            onFeedback={async (id, f) => { setFb((m) => ({ ...m, [id]: f })); try { await AionApi.feedback(sessionId, id, f); } catch (e: any) { setToast(e.message); } }}
            onEnd={async () => { try { await refresh(sessionId); } catch (e: any) { setToast(e.message); } setScreen('validate'); }}
          />
        )}
        {screen === 'validate' && sessionId && state && (
          <ValidateView
            state={state} transcript={transcript}
            onSave={async (gt) => {
              try { const d = await AionApi.finalize(sessionId, gt); setToast(`Saved ${d.sessionId} — ${d.kind}, evaluable: ${d.evaluable}`); setSessionId(null); setScreen('dashboard'); }
              catch (e: any) { setToast(e.message); }
            }}
          />
        )}
        {screen === 'dashboard' && <DashboardView onNewCall={() => setScreen('setup')} />}
      </main>
      <MobileNav screen={screen} onNav={navGuard} live={!!sessionId} />
    </div>
  );
}

function Header({ screen, onNav, live }: { screen: Screen; onNav: (s: Screen) => void; live: boolean }) {
  const tab = (id: Screen, label: string) => (
    <button
      onClick={() => onNav(id)}
      className={cn('rounded-md px-3 py-1.5 text-sm transition-colors', screen === id ? 'bg-secondary text-primary' : 'text-muted-foreground hover:text-foreground')}
    >
      {label}
    </button>
  );
  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <span className="font-semibold tracking-tight">AION · Validation Console</span>
          <Badge variant="secondary" className="ml-1 hidden sm:inline-flex">MISSION-001</Badge>
        </div>
        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          {tab('setup', 'Setup')}
          {live && tab('live', 'Live')}
          {live && tab('validate', 'Validate')}
          {tab('dashboard', 'Dashboard')}
        </nav>
      </div>
    </header>
  );
}

function MobileNav({ screen, onNav, live }: { screen: Screen; onNav: (s: Screen) => void; live: boolean }) {
  const item = (id: Screen, label: string, Icon: any, enabled = true) => (
    <button
      disabled={!enabled}
      onClick={() => onNav(id)}
      className={cn('flex flex-1 flex-col items-center gap-1 py-2 text-[11px]', screen === id ? 'text-primary' : 'text-muted-foreground', !enabled && 'opacity-40')}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
  return (
    <nav className="sticky bottom-0 z-20 flex border-t bg-background/95 backdrop-blur sm:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
      {item('setup', 'Setup', ClipboardEdit)}
      {item('live', 'Live', Headphones, live)}
      {item('validate', 'Validate', ClipboardList, live)}
      {item('dashboard', 'Dashboard', BarChart3)}
    </nav>
  );
}

function SetupView({ schemas, onStart }: { schemas: SchemaInfo[]; onStart: (b: Record<string, unknown>) => void }) {
  const [industry, setIndustry] = useState('funding');
  const [f, setF] = useState({ prospectName: '', role: '', company: '', companyIndustry: '', offerSummary: '', priorObjections: '', outstandingQuestions: '' });
  const schema = schemas.find((s) => s.key === industry);
  const [stageNow, setStageNow] = useState('');
  const [stageNext, setStageNext] = useState('');
  useEffect(() => {
    if (schema) {
      setStageNow(schema.stages[0]?.id ?? '');
      setStageNext(schema.stages.find((s) => s.meaningful)?.id ?? schema.stages[1]?.id ?? '');
    }
  }, [industry, schemas.length]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader><CardTitle>New call session</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div><Label>Industry / schema</Label>
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{schemas.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><Label>Prospect name</Label><Input className="mt-1" value={f.prospectName} onChange={set('prospectName')} placeholder="Marcus Rivera" /></div>
          <div><Label>Role</Label><Input className="mt-1" value={f.role} onChange={set('role')} placeholder="Owner" /></div>
          <div><Label>Company</Label><Input className="mt-1" value={f.company} onChange={set('company')} placeholder="Rivera's Auto Parts" /></div>
          <div><Label>Company industry</Label><Input className="mt-1" value={f.companyIndustry} onChange={set('companyIndustry')} placeholder="auto parts retail" /></div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><Label>Conversion stage (now)</Label>
            <Select value={stageNow} onValueChange={setStageNow}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{schema?.stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}{s.meaningful ? ' ★' : ''}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Desired next stage</Label>
            <Select value={stageNext} onValueChange={setStageNext}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{schema?.stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}{s.meaningful ? ' ★' : ''}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div><Label>Offer summary</Label><Input className="mt-1" value={f.offerSummary} onChange={set('offerSummary')} placeholder="Revenue-based working capital" /></div>
        <div><Label>Prior objections (one per line)</Label><Textarea className="mt-1" value={f.priorObjections} onChange={set('priorObjections')} /></div>
        <div><Label>Outstanding questions (one per line)</Label><Textarea className="mt-1" value={f.outstandingQuestions} onChange={set('outstandingQuestions')} /></div>
        <Button className="w-full" size="lg" onClick={() => onStart({ industry, ...f, conversionStageId: stageNow, desiredNextStageId: stageNext })}>Start session</Button>
      </CardContent>
    </Card>
  );
}

const SIG = { confirmed: ['✓', 'text-ok'], partial: ['~', 'text-warn'], blocked: ['!', 'text-destructive'], missing: ['✗', 'text-muted-foreground'] } as const;

function LiveView(p: {
  sessionId: string; briefing: string; aiPath: string; state: DealState | null; recs: Recommendation[]; transcript: Turn[]; fb: Record<string, string>;
  onIngest: (fn: () => Promise<{ recommendations: Recommendation[] }>) => void;
  onFeedback: (id: string, f: string) => void; onEnd: () => void;
}) {
  const [paste, setPaste] = useState('');
  const [pin, setPin] = useState<PinRole>('auto');
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const mic = useMic((t) => p.onIngest(() => AionApi.ingestText(p.sessionId, t, pin)));
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [p.transcript.length]);

  const send = () => { const t = text.trim(); if (!t) return; setText(''); p.onIngest(() => AionApi.ingestText(p.sessionId, t, pin)); };
  const s = p.state;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.1fr]">
      {/* Guidance column (first on mobile) */}
      <div className="order-1 space-y-4 lg:order-2">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">Live Copilot</CardTitle>
              <Badge variant={p.aiPath === 'claude' ? 'default' : 'secondary'}>{p.aiPath === 'claude' ? 'Claude · governed' : 'deterministic · governed'}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{p.briefing}</p>
            {s && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Stage" value={s.conversationStage} />
                <Stat label="Sentiment" value={s.sentiment} />
                <Stat label="Urgency" value={s.urgency} />
                <Stat label="Readiness" value={`${s.readiness.level} (${s.readiness.score})`} />
              </div>
            )}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next move</div>
              {p.recs.length === 0 && <p className="text-sm text-muted-foreground">Ingest turns to see guidance.</p>}
              <div className="space-y-2">
                {p.recs.map((r) => (
                  <div key={r.id} className="rounded-lg border border-l-2 border-l-primary bg-secondary/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.title}</span>
                      <Badge variant="outline" className="text-[10px]">{r.type}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{r.rationale}</p>
                    {r.suggestedUtterance && <p className="mt-1 text-sm italic">“{r.suggestedUtterance}”</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {['useful', 'acted_on', 'ignored', 'wrong'].map((k) => (
                        <Button key={k} size="sm" variant={p.fb[r.id] === k ? 'default' : 'outline'} className="h-7 px-2 text-xs" onClick={() => p.onFeedback(r.id, k)}>{titleCase(k)}</Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {s && (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {s.readiness.signals.map((sig) => {
                  const [sym, cls] = SIG[sig.state];
                  return <div key={sig.key} className="flex items-center gap-2 text-sm"><span className={cn('w-4 text-center font-bold', cls)}>{sym}</span>{sig.label}{sig.detail ? <span className="text-muted-foreground"> ({sig.detail})</span> : null}</div>;
                })}
              </div>
            )}
            {s && s.objections.filter((o) => o.status !== 'resolved').length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {s.objections.filter((o) => o.status !== 'resolved').map((o) => (
                  <Badge key={o.id} variant="destructive">{o.category}: {o.surface.slice(0, 40)} [{o.status}]</Badge>
                ))}
              </div>
            )}
            {s && s.gaps.length > 0 && (
              <div className="space-y-1">
                {s.gaps.map((g) => <div key={g.id} className="flex items-start gap-2 text-sm text-muted-foreground"><TriangleAlert className="mt-0.5 h-4 w-4 text-warn" />{g.message}</div>)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Conversation column */}
      <div className="order-2 space-y-4 lg:order-1">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">Conversation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div ref={scroller} className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {p.transcript.length === 0 && <p className="text-sm text-muted-foreground">Paste a transcript or start dictating below. The copilot auto-labels the rep vs the lead.</p>}
              {p.transcript.map((t) => <Bubble key={t.index} turn={t} />)}
            </div>
            <Separator />
            {/* live input */}
            <div className="flex items-center gap-2">
              <Button variant={mic.listening ? 'destructive' : 'outline'} size="icon" onClick={mic.toggle} title={mic.supported ? 'Dictate' : 'Speech recognition unsupported'} disabled={!mic.supported}>
                {mic.listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Tabs value={pin} onValueChange={(v) => setPin(v as PinRole)}>
                <TabsList className="h-9">
                  <TabsTrigger value="auto" className="px-2 text-xs">Auto</TabsTrigger>
                  <TabsTrigger value="rep" className="px-2 text-xs">Rep</TabsTrigger>
                  <TabsTrigger value="prospect" className="px-2 text-xs">Lead</TabsTrigger>
                </TabsList>
              </Tabs>
              <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="what was just said…" />
              <Button size="icon" onClick={send}><Send className="h-4 w-4" /></Button>
            </div>
            {mic.error && <p className="text-xs text-warn">{mic.error}</p>}
            {mic.listening && <p className="text-xs text-muted-foreground">Listening — role is auto-detected from what's said{pin !== 'auto' ? `, pinned to ${pin === 'rep' ? 'Rep' : 'Lead'}` : ''}.</p>}
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">Paste a full transcript</summary>
              <Textarea className="mt-2" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Rep: Hi Marcus…\nProspect: Sure, what\'s this about?\n\n(or paste unlabeled / "Speaker 1:" text — roles are inferred)'} />
              <Button className="mt-2" onClick={() => { const t = paste.trim(); if (!t) return; setPaste(''); p.onIngest(() => AionApi.ingestTranscript(p.sessionId, t)); }}>Ingest transcript</Button>
            </details>
            <Button variant="secondary" className="w-full" onClick={p.onEnd}><PhoneOff className="mr-1 h-4 w-4" /> End call → validate</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-secondary/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-semibold capitalize">{value}</div>
    </div>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  if (turn.speaker === 'system') return <div className="text-center text-xs text-muted-foreground">{turn.text}</div>;
  const rep = turn.speaker === 'rep';
  return (
    <div className={cn('flex gap-2', rep ? 'flex-row' : 'flex-row-reverse')}>
      <div className={cn('mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', rep ? 'bg-primary/20 text-primary' : 'bg-warn/20 text-warn')}>
        {rep ? <UserRound className="h-4 w-4" /> : <User className="h-4 w-4" />}
      </div>
      <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm', rep ? 'rounded-tl-sm bg-secondary' : 'rounded-tr-sm bg-warn/10')}>
        <div className={cn('mb-0.5 text-[10px] font-semibold uppercase tracking-wide', rep ? 'text-primary' : 'text-warn')}>{rep ? 'Rep' : 'Lead'}</div>
        {turn.text}
      </div>
    </div>
  );
}

function ValidateView({ state, transcript, onSave }: { state: DealState; transcript: Turn[]; onSave: (gt: unknown) => void }) {
  const [verdicts, setVerdicts] = useState<Record<string, { verdict: string; corrected?: string }>>({});
  const [guidance, setGuidance] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('application');
  const [disposition, setDisposition] = useState('conversation');
  const [advanced, setAdvanced] = useState(false);
  const [downstream, setDownstream] = useState('');
  const suggestEval = useMemo(() => {
    const pt = transcript.filter((t) => t.speaker === 'prospect');
    return pt.length >= 2 && pt.reduce((n, t) => n + t.text.split(/\s+/).length, 0) >= 40;
  }, [transcript]);
  const [evaluable, setEvaluable] = useState(suggestEval);
  const [notes, setNotes] = useState('');

  const setV = (k: string, verdict: string) => setVerdicts((m) => ({ ...m, [k]: { verdict, corrected: m[k]?.corrected } }));

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader><CardTitle>Rep validation — ground truth</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">Spend 30–60s correcting the AI. These corrections are the ground truth.</div>
        <div className="space-y-3">
          {GT_FIELDS.map((fld) => (
            <div key={fld.key} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-32 font-medium">{fld.label}</span>
                <span className="flex-1 truncate text-sm text-muted-foreground">AI: {fld.get(state)}</span>
                <div className="flex gap-1">
                  {([['correct', Check], ['incorrect', X], ['edited', Pencil], ['not_applicable', Ban]] as const).map(([v, Icon]) => (
                    <Button key={v} size="icon" variant={verdicts[fld.key]?.verdict === v ? 'default' : 'outline'} className="h-8 w-8" onClick={() => setV(fld.key, v)} title={titleCase(v)}><Icon className="h-4 w-4" /></Button>
                  ))}
                </div>
              </div>
              {verdicts[fld.key]?.verdict === 'edited' && (
                <Input placeholder="corrected value" value={verdicts[fld.key]?.corrected ?? ''} onChange={(e) => setVerdicts((m) => ({ ...m, [fld.key]: { verdict: 'edited', corrected: e.target.value } }))} />
              )}
            </div>
          ))}
        </div>
        <div>
          <Label>Was the guidance useful?</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {['useful', 'acted_on', 'ignored', 'wrong', 'mixed'].map((g) => (
              <Button key={g} size="sm" variant={guidance === g ? 'default' : 'outline'} onClick={() => setGuidance(g)}>{titleCase(g)}</Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><Label>Call outcome</Label>
            <Select value={outcome} onValueChange={setOutcome}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{OUTCOMES.map((o) => <SelectItem key={o} value={o}>{titleCase(o)}</SelectItem>)}</SelectContent></Select>
          </div>
          <div><Label>Disposition</Label>
            <Select value={disposition} onValueChange={setDisposition}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{DISPOSITIONS.map((o) => <SelectItem key={o} value={o}>{titleCase(o)}</SelectItem>)}</SelectContent></Select>
          </div>
          <div><Label>Did the deal advance?</Label>
            <div className="mt-1 flex gap-1.5">
              <Button size="sm" variant={advanced ? 'default' : 'outline'} onClick={() => setAdvanced(true)}>Yes</Button>
              <Button size="sm" variant={!advanced ? 'default' : 'outline'} onClick={() => setAdvanced(false)}>No</Button>
            </div>
          </div>
          <div><Label>Downstream conversion</Label>
            <Select value={downstream || 'none'} onValueChange={(v) => setDownstream(v === 'none' ? '' : v)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{DOWNSTREAM.map((o) => <SelectItem key={o || 'none'} value={o || 'none'}>{o ? titleCase(o) : 'None'}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={evaluable} onCheckedChange={(v) => setEvaluable(!!v)} /> Evaluable conversation (counts toward the 25-gate)</label>
        <div><Label>Notes</Label><Textarea className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <Button className="w-full" size="lg" onClick={() => onSave({ fields: verdicts, guidance, outcome, disposition, advanced, downstreamConversion: downstream || null, evaluable, notes })}>Save canonical record</Button>
      </CardContent>
    </Card>
  );
}

function DashboardView({ onNewCall }: { onNewCall: () => void }) {
  const [m, setM] = useState<DashboardMetrics | null>(null);
  const [records, setRecords] = useState<DashboardRecord[]>([]);
  const load = () => AionApi.dashboard().then((d) => { setM(d.metrics); setRecords(d.records); }).catch(() => {});
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Validation dashboard</h2>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={load}><RotateCcw className="mr-1 h-4 w-4" /> Refresh</Button>
          <Button size="sm" onClick={onNewCall}>New call</Button>
        </div>
      </div>
      {m && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Gate label="Real calls" g={m.realCalls} />
            <AccTile label="Fact accuracy" v={m.factAccuracy} target={0.85} />
            <AccTile label="Objection accuracy" v={m.objectionAccuracy} target={0.85} />
            <AccTile label="Useful interventions" v={m.usefulInterventionRate} target={0.6} />
            <Gate label="Conversion advances" g={m.conversionAdvances} />
            <Gate label="Downstream conversions" g={m.downstreamConversions} />
            <AccTile label="Lineage completeness" v={m.lineageCompleteness} target={1} />
            <Tile label="Sessions / dials" value={`${m.totalSessions} / ${m.totalDials}`} />
            <Tile label="All gates" value={m.gatesMet ? 'PASS' : '—'} good={m.gatesMet} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Failure data (dispositions)</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(m.dispositions).map(([k, v]) => <Badge key={k} variant="secondary">{titleCase(k)}: {v}</Badge>)}
              {Object.keys(m.dispositions).length === 0 && <span className="text-sm text-muted-foreground">none yet</span>}
            </div>
          </div>
        </>
      )}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">Sessions</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr className="border-b">
              {['When', 'Prospect', 'Industry', 'Kind', 'Disposition', 'Eval', 'Outcome', 'Adv', 'AI stage'].map((h) => <th key={h} className="px-2 py-2 text-left font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.sessionId} className="border-b border-border/60">
                  <td className="px-2 py-2">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-2">{r.prospect}</td><td className="px-2 py-2">{r.industry}</td>
                  <td className="px-2 py-2">{titleCase(r.kind)}</td><td className="px-2 py-2">{titleCase(r.disposition)}</td>
                  <td className="px-2 py-2">{r.evaluable ? '✓' : '—'}</td><td className="px-2 py-2">{r.outcome ? titleCase(r.outcome) : '—'}</td>
                  <td className="px-2 py-2">{r.advanced ? '▲' : '—'}</td><td className="px-2 py-2">{r.aiStage}</td>
                </tr>
              ))}
              {records.length === 0 && <tr><td colSpan={9} className="px-2 py-6 text-center text-muted-foreground">No sessions yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <Card className={cn(good && 'border-ok/50')}>
      <CardContent className="p-4"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></CardContent>
    </Card>
  );
}
function Gate({ label, g }: { label: string; g: GateStatus }) {
  return <Card className={cn(g.met ? 'border-ok/50' : 'border-border')}><CardContent className="p-4"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold">{g.value} / {g.target}</div></CardContent></Card>;
}
function AccTile({ label, v, target }: { label: string; v: number | null; target: number }) {
  const met = v != null && v >= target;
  return <Card className={cn(met ? 'border-ok/50' : 'border-border')}><CardContent className="p-4"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold">{pct(v)}</div></CardContent></Card>;
}
