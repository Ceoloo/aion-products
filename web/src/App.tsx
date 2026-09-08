import { useEffect, useRef, useState } from 'react';
import { AionApi, type DealState, type Recommendation, type SchemaInfo, type Turn } from '@/lib/api';
import { CockpitShell, type Room } from '@/components/cockpit/Shell';
import { LaunchPad } from '@/components/cockpit/LaunchPad';
import { LiveCockpit } from '@/components/cockpit/LiveCockpit';
import { Debrief } from '@/components/cockpit/Debrief';
import { ControlRoom } from '@/components/cockpit/ControlRoom';

export default function App() {
  const [room, setRoom] = useState<Room>('launch');
  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [leadName, setLeadName] = useState('');
  const [briefing, setBriefing] = useState('');
  const [aiPath, setAiPath] = useState('');
  const [state, setState] = useState<DealState | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [fb, setFb] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    AionApi.schemas()
      .then((d) => setSchemas(d.schemas))
      .catch((e) => setToast(e.message));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = async (id: string) => {
    const d = await AionApi.state(id);
    setState(d.state);
    setTranscript(d.transcript);
  };

  const ingestChain = useRef<Promise<void>>(Promise.resolve());

  const navGuard = (target: Room) => {
    if (sessionId && target === 'launch' && room !== 'launch') {
      if (
        !window.confirm(
          'Leave this live engagement? The current cockpit session will be abandoned (not saved to the mission log).',
        )
      ) {
        return;
      }
      void AionApi.abandonLive(sessionId).catch(() => {});
      setSessionId(null);
      setLeadName('');
      setState(null);
      setRecs([]);
      setTranscript([]);
    }
    setRoom(target);
  };

  return (
    <CockpitShell room={room} onNav={navGuard} live={!!sessionId} leadName={leadName || undefined} toast={toast}>
      {room === 'launch' && (
        <LaunchPad
          schemas={schemas}
          onStart={async (body) => {
            try {
              const d = await AionApi.createSession(body);
              setSessionId(d.sessionId);
              setBriefing(d.briefing);
              setAiPath(d.aiPath);
              setLeadName(String(body.prospectName ?? ''));
              setState(null);
              setRecs([]);
              setTranscript([]);
              setFb({});
              setRoom('live');
            } catch (e: any) {
              setToast(e.message);
            }
          }}
        />
      )}

      {room === 'live' && sessionId && (
        <LiveCockpit
          sessionId={sessionId}
          briefing={briefing}
          aiPath={aiPath}
          leadName={leadName || undefined}
          state={state}
          recs={recs}
          transcript={transcript}
          fb={fb}
          onIngest={(fn) => {
            ingestChain.current = ingestChain.current.then(async () => {
              try {
                const r = await fn();
                setRecs(r.recommendations);
                await refresh(sessionId);
              } catch (e: any) {
                setToast(e.message);
              }
            });
          }}
          onFeedback={async (id, f) => {
            setFb((m) => ({ ...m, [id]: f }));
            try {
              await AionApi.feedback(sessionId, id, f);
            } catch (e: any) {
              setToast(e.message);
            }
          }}
          onEnd={async () => {
            try {
              await refresh(sessionId);
            } catch (e: any) {
              setToast(e.message);
            }
            setRoom('debrief');
          }}
        />
      )}

      {room === 'debrief' && sessionId && state && (
        <Debrief
          state={state}
          transcript={transcript}
          onSave={async (gt) => {
            try {
              const d = await AionApi.finalize(sessionId, gt);
              setToast(`Mission locked · ${d.kind}${d.evaluable ? ' · evaluable' : ''}`);
              setSessionId(null);
              setLeadName('');
              setRoom('control');
            } catch (e: any) {
              setToast(e.message);
            }
          }}
        />
      )}

      {room === 'control' && <ControlRoom onNewCall={() => setRoom('launch')} />}
    </CockpitShell>
  );
}
