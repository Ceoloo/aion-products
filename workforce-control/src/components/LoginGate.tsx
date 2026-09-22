import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Status = 'checking' | 'signed-out' | 'signed-in';

const SESSION_EXPIRED_EVENT = 'aion:session-expired';

/**
 * Gates the Console behind the BFF session cookie (api/login.ts,
 * api/session.ts). Nothing renders until we know the session state, so the
 * app never flashes real data before auth is confirmed.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;

    fetch('/api/session', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Session endpoint returned ${res.status}`);
        return res.json() as Promise<{ authenticated: boolean }>;
      })
      .then((data) => {
        if (active) setStatus(data.authenticated ? 'signed-in' : 'signed-out');
      })
      .catch(() => {
        if (active) setStatus('signed-out');
      });

    const handleSessionExpired = () => {
      setSecret('');
      setError('Your session expired. Sign in again.');
      setStatus('signed-out');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);

    return () => {
      active = false;
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      if (!res.ok) {
        setError(
          res.status === 401
            ? 'Incorrect operator secret.'
            : 'Could not sign in. Try again.',
        );
        return;
      }
      setSecret('');
      setStatus('signed-in');
    } catch {
      setError('Could not reach the sign-in endpoint.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    setError(null);
    try {
      const res = await fetch('/api/logout', { method: 'POST' });
      if (!res.ok) {
        setError('Could not sign out. Try again.');
        return;
      }
      setSecret('');
      setStatus('signed-out');
    } catch {
      setError('Could not reach the sign-out endpoint.');
    } finally {
      setLoggingOut(false);
    }
  }

  if (status === 'checking') return null;

  if (status === 'signed-out') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-border p-6">
          <div>
            <h1 className="font-display text-lg">AION Operator Console</h1>
            <p className="text-sm text-muted-foreground">Sign in to continue.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="operator-secret">Operator secret</Label>
            <Input
              id="operator-secret"
              type="password"
              autoFocus
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting || !secret}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="fixed right-4 top-4 z-50">
        <Button type="button" variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
      {children}
    </>
  );
}
