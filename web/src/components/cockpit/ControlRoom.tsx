import { useEffect, useState } from 'react';
import { Eye, RotateCcw, Trash2, Zap } from 'lucide-react';
import {
  AionApi,
  type DashboardMetrics,
  type DashboardRecord,
  type GateStatus,
  type SessionRecordDetail,
} from '@/lib/api';
import { DISPOSITIONS, DOWNSTREAM, OUTCOMES, pct, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

export function ControlRoom({ onNewCall }: { onNewCall: () => void }) {
  const [m, setM] = useState<DashboardMetrics | null>(null);
  const [records, setRecords] = useState<DashboardRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionRecordDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    AionApi.dashboard()
      .then((d) => {
        setM(d.metrics);
        setRecords(d.records);
      })
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const openRecord = async (id: string) => {
    setSelectedId(id);
    setErr(null);
    setDetail(null);
    try {
      const d = await AionApi.getSession(id);
      setDetail(d.record);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this mission from the control room log?')) return;
    setBusy(true);
    setErr(null);
    try {
      await AionApi.deleteSession(id);
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveGt = async (groundTruth: unknown) => {
    if (!selectedId) return;
    setBusy(true);
    setErr(null);
    try {
      const d = await AionApi.updateSession(selectedId, groundTruth);
      setDetail(d.record);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="room-enter space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Control room</p>
          <h1 className="font-display text-2xl font-bold md:text-3xl">Mission command</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Conversion gates, intervention quality, and the session log. Not a CRM — GoHighLevel owns contacts; this room proves Copilot is moving deals.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load}>
            <RotateCcw className="mr-1.5 h-4 w-4" /> Refresh
          </Button>
          <Button size="sm" onClick={onNewCall}>
            <Zap className="mr-1.5 h-4 w-4" /> New engagement
          </Button>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {m && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            <GateCard label="Real conversations" g={m.realCalls} />
            <AccCard label="Fact accuracy" v={m.factAccuracy} target={0.85} />
            <AccCard label="Objection accuracy" v={m.objectionAccuracy} target={0.85} />
            <AccCard label="Useful interventions" v={m.usefulInterventionRate} target={0.6} />
            <GateCard label="Ladder advances" g={m.conversionAdvances} />
            <GateCard label="Downstream wins" g={m.downstreamConversions} />
            <AccCard label="Lineage complete" v={m.lineageCompleteness} target={1} />
            <MetricCard label="Sessions / dials" value={`${m.totalSessions} / ${m.totalDials}`} good={m.gatesMet} sub={m.gatesMet ? 'All gates green' : 'Gates in progress'} />
          </div>

          <div className="panel p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Failure modes (still valuable)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(m.dispositions).map(([k, v]) => (
                <Badge key={k} variant="secondary">{titleCase(k)}: {v}</Badge>
              ))}
              {Object.keys(m.dispositions).length === 0 && (
                <span className="text-sm text-muted-foreground">No dispositions yet — run engagements.</span>
              )}
            </div>
          </div>
        </>
      )}

      <section className="panel overflow-hidden">
        <div className="border-b border-border/60 px-4 py-3">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">Mission log</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                {['When', 'Lead', 'Playbook', 'Kind', 'Disposition', 'Eval', 'Outcome', 'Adv', 'Stage Δ', ''].map((h) => (
                  <th key={h || 'a'} className="px-3 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr
                  key={r.sessionId}
                  className={cn(
                    'border-b border-border/40 transition hover:bg-secondary/30',
                    selectedId === r.sessionId && 'bg-secondary/40',
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 font-medium">{r.prospect}</td>
                  <td className="px-3 py-2.5">{r.industry}</td>
                  <td className="px-3 py-2.5">{titleCase(r.kind)}</td>
                  <td className="px-3 py-2.5">{titleCase(r.disposition)}</td>
                  <td className="px-3 py-2.5">{r.evaluable ? '✓' : '—'}</td>
                  <td className="px-3 py-2.5">{r.outcome ? titleCase(r.outcome) : '—'}</td>
                  <td className="px-3 py-2.5">{r.advanced ? '▲' : '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.aiStage}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <Button size="icon" variant="outline" className="h-7 w-7" title="Inspect" onClick={() => openRecord(r.sessionId)} disabled={busy}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="outline" className="h-7 w-7 text-destructive" title="Delete" onClick={() => remove(r.sessionId)} disabled={busy}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                    No missions yet. Launch an engagement from the cockpit.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detail && selectedId && (
        <MissionInspector
          record={detail}
          busy={busy}
          onClose={() => {
            setSelectedId(null);
            setDetail(null);
          }}
          onDelete={() => remove(selectedId)}
          onSave={saveGt}
        />
      )}
    </div>
  );
}

function MissionInspector({
  record,
  busy,
  onClose,
  onDelete,
  onSave,
}: {
  record: SessionRecordDetail;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
  onSave: (gt: unknown) => void;
}) {
  const gt = record.after.groundTruth;
  const [outcome, setOutcome] = useState(gt?.outcome ?? '');
  const [disposition, setDisposition] = useState(gt?.disposition ?? '');
  const [advanced, setAdvanced] = useState(gt?.advanced ?? false);
  const [downstream, setDownstream] = useState(gt?.downstreamConversion ?? '');
  const [evaluable, setEvaluable] = useState(gt?.evaluable ?? record.evaluable);
  const [guidance, setGuidance] = useState<string | null>(gt?.guidance ?? null);
  const [notes, setNotes] = useState(gt?.notes ?? '');
  const [verdicts, setVerdicts] = useState<Record<string, { verdict: string; corrected?: string }>>(gt?.fields ?? {});

  useEffect(() => {
    const next = record.after.groundTruth;
    setOutcome(next?.outcome ?? '');
    setDisposition(next?.disposition ?? '');
    setAdvanced(next?.advanced ?? false);
    setDownstream(next?.downstreamConversion ?? '');
    setEvaluable(next?.evaluable ?? record.evaluable);
    setGuidance(next?.guidance ?? null);
    setNotes(next?.notes ?? '');
    setVerdicts(next?.fields ?? {});
  }, [record]);

  return (
    <div className="panel guidance-enter overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Mission inspector</h2>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{record.sessionId}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
          <Button size="sm" variant="destructive" onClick={onDelete} disabled={busy}>
            <Trash2 className="mr-1 h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Meta label="Lead" value={record.before.context.prospect.name} />
            <Meta label="Playbook" value={record.industry} />
            <Meta label="Kind" value={titleCase(record.kind)} />
            <Meta label="Turns" value={String(record.during.transcript.length)} />
          </div>
          <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-border/50 bg-background/30 p-3 text-sm">
            {record.during.transcript.map((t) => (
              <div key={t.index}>
                <span className="font-medium capitalize text-muted-foreground">{t.speaker}: </span>
                {t.text}
              </div>
            ))}
            {record.during.transcript.length === 0 && <p className="text-muted-foreground">No transcript.</p>}
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Outcome</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{OUTCOMES.map((o) => <SelectItem key={o} value={o}>{titleCase(o)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Disposition</Label>
              <Select value={disposition} onValueChange={setDisposition}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{DISPOSITIONS.map((o) => <SelectItem key={o} value={o}>{titleCase(o)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Advanced?</Label>
              <div className="mt-1 flex gap-1.5">
                <Button size="sm" variant={advanced ? 'default' : 'outline'} onClick={() => setAdvanced(true)}>Yes</Button>
                <Button size="sm" variant={!advanced ? 'default' : 'outline'} onClick={() => setAdvanced(false)}>No</Button>
              </div>
            </div>
            <div>
              <Label>Downstream</Label>
              <Select value={downstream || 'none'} onValueChange={(v) => setDownstream(v === 'none' ? '' : v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOWNSTREAM.map((o) => (
                    <SelectItem key={o || 'none'} value={o || 'none'}>{o ? titleCase(o) : 'None'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Guidance</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {['useful', 'acted_on', 'ignored', 'wrong', 'mixed'].map((g) => (
                <Button key={g} size="sm" variant={guidance === g ? 'default' : 'outline'} className="rounded-full" onClick={() => setGuidance(g)}>
                  {titleCase(g)}
                </Button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={evaluable} onCheckedChange={(v) => setEvaluable(!!v)} />
            Evaluable conversation
          </label>
          <div>
            <Label>Notes</Label>
            <Textarea className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button
            className="w-full"
            disabled={busy || !outcome || !disposition}
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
            Update mission truth
          </Button>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-inset px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  );
}

function MetricCard({ label, value, good, sub }: { label: string; value: string; good?: boolean; sub?: string }) {
  return (
    <div className={cn('panel p-4', good && 'border-ok/40')}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function GateCard({ label, g }: { label: string; g: GateStatus }) {
  return (
    <div className={cn('panel p-4', g.met && 'border-ok/40')}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">
        {g.value} <span className="text-base font-medium text-muted-foreground">/ {g.target}</span>
      </div>
    </div>
  );
}

function AccCard({ label, v, target }: { label: string; v: number | null; target: number }) {
  const met = v != null && v >= target;
  return (
    <div className={cn('panel p-4', met && 'border-ok/40')}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{pct(v)}</div>
      <div className="mt-1 text-xs text-muted-foreground">target {Math.round(target * 100)}%</div>
    </div>
  );
}
