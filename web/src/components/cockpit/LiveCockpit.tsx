import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Mic, PhoneOff, Send, Square, TriangleAlert, User, UserRound,
} from 'lucide-react';
import { AionApi, type DealState, type Recommendation, type Turn } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { useMic } from '@/hooks/useMic';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type PinRole = 'auto' | 'rep' | 'prospect';

const SIG = {
  confirmed: ['●', 'text-ok'],
  partial: ['◐', 'text-warn'],
  blocked: ['✕', 'text-destructive'],
  missing: ['○', 'text-muted-foreground'],
} as const;

export function LiveCockpit(p: {
  sessionId: string;
  briefing: string;
  aiPath: string;
  leadName?: string;
  state: DealState | null;
  recs: Recommendation[];
  transcript: Turn[];
  fb: Record<string, string>;
  onIngest: (fn: () => Promise<{ recommendations: Recommendation[] }>) => void;
  onFeedback: (id: string, f: string) => void;
  onEnd: () => void;
}) {
  const [paste, setPaste] = useState('');
  const [pin, setPin] = useState<PinRole>('auto');
  const [text, setText] = useState('');
  const [intelTab, setIntelTab] = useState<'move' | 'radar'>('move');
  const scroller = useRef<HTMLDivElement>(null);
  const mic = useMic((t) => p.onIngest(() => AionApi.ingestText(p.sessionId, t, pin)));

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [p.transcript.length]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    p.onIngest(() => AionApi.ingestText(p.sessionId, t, pin));
  };

  const s = p.state;
  const topRec = p.recs[0];

  return (
    <div className="room-enter grid h-[calc(100dvh-8.5rem)] gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
      {/* Conversation — ChatGPT-like stage */}
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 md:px-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="signal-live">Live channel</span>
              {p.leadName && (
                <span className="text-sm text-muted-foreground">with <span className="text-foreground">{p.leadName}</span></span>
              )}
            </div>
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{p.briefing}</p>
          </div>
          <Badge variant={p.aiPath === 'claude' ? 'default' : 'secondary'} className="shrink-0">
            {p.aiPath === 'claude' ? 'Claude · governed' : 'Deterministic · governed'}
          </Badge>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-5">
          {p.transcript.length === 0 && (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Mic className="h-5 w-5" />
              </div>
              <p className="font-display text-lg font-semibold">Open the channel</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Dictate, type what was just said, or paste a transcript. Copilot labels Rep vs Lead and starts guiding.
              </p>
            </div>
          )}
          {p.transcript.map((t) => (
            <Bubble key={t.index} turn={t} />
          ))}
        </div>

        <div className="border-t border-border/60 bg-card/40 p-3 md:p-4">
          <div className="composer-shell">
            <Button
              variant={mic.listening ? 'destructive' : 'outline'}
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl"
              onClick={mic.toggle}
              title={mic.supported ? 'Dictate' : 'Speech recognition unsupported'}
              disabled={!mic.supported}
            >
              {mic.listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Tabs value={pin} onValueChange={(v) => setPin(v as PinRole)}>
              <TabsList className="h-10 rounded-xl bg-secondary/60">
                <TabsTrigger value="auto" className="rounded-lg px-2.5 text-xs">Auto</TabsTrigger>
                <TabsTrigger value="rep" className="rounded-lg px-2.5 text-xs">You</TabsTrigger>
                <TabsTrigger value="prospect" className="rounded-lg px-2.5 text-xs">Lead</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="What was just said…"
              className="h-10 border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <Button size="icon" className="h-10 w-10 shrink-0 rounded-xl" onClick={send}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          {mic.error && <p className="mt-2 text-xs text-warn">{mic.error}</p>}
          {mic.listening && (
            <p className="mt-2 text-xs text-live">Listening — roles auto-detected{pin !== 'auto' ? `, pinned to ${pin === 'rep' ? 'you' : 'lead'}` : ''}.</p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Paste full transcript</summary>
            <Textarea
              className="mt-2"
              rows={4}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'Rep: Hi Marcus…\nProspect: Sure, what\'s this about?'}
            />
            <Button
              className="mt-2"
              variant="secondary"
              onClick={() => {
                const t = paste.trim();
                if (!t) return;
                setPaste('');
                p.onIngest(() => AionApi.ingestTranscript(p.sessionId, t));
              }}
            >
              Ingest transcript
            </Button>
          </details>
          <Button variant="secondary" className="mt-3 w-full" onClick={p.onEnd}>
            <PhoneOff className="mr-2 h-4 w-4" /> End call · open debrief
          </Button>
        </div>
      </section>

      {/* Jarvis intel rail */}
      <aside className="panel flex min-h-0 flex-col overflow-hidden jarvis-glow">
        <div className="flex items-center gap-1 border-b border-border/60 p-2">
          <button
            type="button"
            onClick={() => setIntelTab('move')}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition',
              intelTab === 'move' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Next move
          </button>
          <button
            type="button"
            onClick={() => setIntelTab('radar')}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition',
              intelTab === 'radar' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Deal radar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {intelTab === 'move' ? (
            <div className="space-y-4">
              {topRec ? (
                <div className="guidance-enter rounded-2xl border border-primary/30 bg-primary/10 p-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                    <ArrowRight className="h-3.5 w-3.5" /> Copilot says
                  </div>
                  <h2 className="mt-2 font-display text-xl font-bold leading-snug">{topRec.title}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{topRec.rationale}</p>
                  {topRec.suggestedUtterance && (
                    <blockquote className="mt-3 rounded-xl border border-border/50 bg-background/40 px-3 py-2 text-sm italic leading-relaxed">
                      “{topRec.suggestedUtterance}”
                    </blockquote>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {['acted_on', 'useful', 'ignored', 'wrong'].map((k) => (
                      <Button
                        key={k}
                        size="sm"
                        variant={p.fb[topRec.id] === k ? 'default' : 'outline'}
                        className="h-8 rounded-full px-3 text-xs"
                        onClick={() => p.onFeedback(topRec.id, k)}
                      >
                        {k === 'acted_on' ? 'I said it' : titleCase(k)}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center">
                  <p className="font-display text-base font-semibold">Waiting for signal</p>
                  <p className="mt-1 text-sm text-muted-foreground">Send the first turn — guidance appears here like a live chat partner.</p>
                </div>
              )}

              {p.recs.slice(1).map((r, i) => (
                <div key={r.id} className="guidance-enter rounded-xl border border-border/60 bg-background/30 p-3" style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.title}</span>
                    <Badge variant="outline" className="text-[10px]">{r.type}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{r.rationale}</p>
                  {r.suggestedUtterance && <p className="mt-1 text-sm italic text-foreground/90">“{r.suggestedUtterance}”</p>}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {['acted_on', 'useful', 'ignored', 'wrong'].map((k) => (
                      <Button key={k} size="sm" variant={p.fb[r.id] === k ? 'default' : 'outline'} className="h-7 px-2 text-[11px]" onClick={() => p.onFeedback(r.id, k)}>
                        {k === 'acted_on' ? 'Used' : titleCase(k)}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {s ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <RadarStat label="Stage" value={s.conversationStage} />
                    <RadarStat label="Sentiment" value={s.sentiment} />
                    <RadarStat label="Urgency" value={s.urgency} />
                    <RadarStat label="Readiness" value={`${s.readiness.level} · ${s.readiness.score}`} />
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ladder position</div>
                    <div className="panel-inset px-3 py-2 text-sm">
                      Order {s.position.currentOrder}
                      <span className="text-muted-foreground"> · high water {s.position.highWaterOrder}</span>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Readiness signals</div>
                    <div className="space-y-1.5">
                      {s.readiness.signals.map((sig) => {
                        const [sym, cls] = SIG[sig.state];
                        return (
                          <div key={sig.key} className="flex items-start gap-2 text-sm">
                            <span className={cn('mt-0.5 w-4 text-center text-xs', cls)}>{sym}</span>
                            <span>
                              {sig.label}
                              {sig.detail ? <span className="text-muted-foreground"> — {sig.detail}</span> : null}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {s.objections.filter((o) => o.status !== 'resolved').length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Open objections</div>
                      <div className="flex flex-wrap gap-1.5">
                        {s.objections.filter((o) => o.status !== 'resolved').map((o) => (
                          <Badge key={o.id} variant="destructive" className="max-w-full truncate">
                            {o.category}: {o.surface.slice(0, 48)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {s.gaps.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Gaps</div>
                      {s.gaps.map((g) => (
                        <div key={g.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                          {g.message}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Deal radar fills once the first turn lands.</p>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function RadarStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-inset px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold capitalize">{value}</div>
    </div>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  if (turn.speaker === 'system') {
    return <div className="text-center text-xs text-muted-foreground">{turn.text}</div>;
  }
  const you = turn.speaker === 'rep';
  return (
    <div className={cn('flex gap-2.5 animate-fade-up', you ? 'flex-row' : 'flex-row-reverse')}>
      <div
        className={cn(
          'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          you ? 'bg-primary/20 text-primary' : 'bg-accent/20 text-accent',
        )}
      >
        {you ? <UserRound className="h-4 w-4" /> : <User className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          'max-w-[min(85%,36rem)] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
          you ? 'rounded-tl-md bg-secondary/90' : 'rounded-tr-md bg-accent/15',
        )}
      >
        <div className={cn('mb-0.5 text-[10px] font-semibold uppercase tracking-wide', you ? 'text-primary' : 'text-accent')}>
          {you ? 'You' : 'Lead'}
        </div>
        {turn.text}
      </div>
    </div>
  );
}
