import { useEffect, useRef, useState } from 'react';

// Minimal typings for the Web Speech API (not in lib.dom for all TS setups).
type SR = {
  continuous: boolean; interimResults: boolean; lang: string;
  start: () => void; stop: () => void;
  onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null;
};

/**
 * Live speech-to-text via the browser Web Speech API. Emits finalized
 * utterances; speaker-role attribution happens server-side (auto) unless the
 * operator pins a role. Returns whether STT is supported and a listening flag.
 */
export function useMic(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const wantRef = useRef(false);
  const cbRef = useRef(onFinal);
  cbRef.current = onFinal;

  useEffect(() => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSupported(!!Ctor);
  }, []);

  const start = () => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) { setError('Speech recognition is not supported in this browser.'); return; }
    const rec: SR = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const t = String(e.results[i][0].transcript || '').trim();
          if (t) cbRef.current(t);
        }
      }
    };
    rec.onerror = (e: any) => setError(`mic: ${e?.error ?? 'error'}`);
    rec.onend = () => { if (wantRef.current) { try { rec.start(); } catch { /* ignore */ } } };
    recRef.current = rec;
    wantRef.current = true;
    setError(null);
    try { rec.start(); setListening(true); } catch (e) { setError(String(e)); }
  };

  const stop = () => {
    wantRef.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  };

  useEffect(() => () => { wantRef.current = false; try { recRef.current?.stop(); } catch { /* ignore */ } }, []);

  return { supported, listening, error, start, stop, toggle: () => (listening ? stop() : start()) };
}
