import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { useTenant } from '@/hooks/useTenant';
import { RuntimeApi, RuntimeHttpError } from '@/lib/runtime-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const OPERATOR_ID =
  (import.meta.env.VITE_AION_OPERATOR_ID as string | undefined) ?? 'operator-console';

/**
 * IE-001 — create ImplementationCase (commercial handoff record).
 */
export default function NewImplementation() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [clientName, setClientName] = useState('');
  const [clientRef, setClientRef] = useState('');
  const [ownerId, setOwnerId] = useState(OPERATOR_ID);
  const [commercialStatus, setCommercialStatus] = useState('signed');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await RuntimeApi.createImplementation(tenantId, {
        clientName: clientName.trim(),
        clientRef: clientRef.trim(),
        ownerId: ownerId.trim() || OPERATOR_ID,
        commercialStatus,
      });
      navigate(`/implementations/${res.case.caseId}`);
    } catch (err: unknown) {
      setError(
        err instanceof RuntimeHttpError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Create failed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-1">
          IE-001
        </p>
        <h1 className="font-display text-3xl tracking-tight">New implementation</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-xl">
          Commercial status is recorded separately from delivery readiness. A signed
          or paid client still starts in <span className="font-mono">draft</span>.
        </p>
      </div>

      <form onSubmit={onSubmit} className="max-w-lg space-y-4">
        <div className="space-y-2">
          <Label htmlFor="clientName">Client name</Label>
          <Input
            id="clientName"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="clientRef">Client / tenant reference</Label>
          <Input
            id="clientRef"
            value={clientRef}
            onChange={(e) => setClientRef(e.target.value)}
            placeholder="client-acme"
            className="font-mono"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ownerId">Accountable owner</Label>
          <Input
            id="ownerId"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="font-mono"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Commercial status</Label>
          <Select value={commercialStatus} onValueChange={setCommercialStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prospect">prospect</SelectItem>
              <SelectItem value="signed">signed</SelectItem>
              <SelectItem value="paid">paid</SelectItem>
              <SelectItem value="on_hold">on_hold</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error && <p className="text-sm text-destructive font-mono">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create case'}
          </Button>
          <Button asChild type="button" variant="outline">
            <Link to="/implementations">Cancel</Link>
          </Button>
        </div>
      </form>
    </Shell>
  );
}
