import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Status = 'checking' | 'signed-out' | 'signed-in';

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

  useEffect(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((d: { authenticated: boolean }) => setStatus(d.authenticated ? 'signed-in' : 'signed-out'))
      .catch(() => setStatus('signed-out'));
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
        setError('Incorrect operator secret.');
        return;
      }
      setStatus('signed-in');
    } catch {
      setError('Could not reach the sign-in endpoint.');
    } finally {
      setSubmitting(false);
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

  return <>{children}</>;
}
