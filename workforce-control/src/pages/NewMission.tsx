import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { useTenant } from '@/hooks/useTenant';
import { RuntimeApi, RuntimeHttpError } from '@/lib/runtime-api';
import { REVENUE_PRODUCTION_V1, WORKFLOW_TEMPLATES } from '@/lib/workflows';
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

function mintId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * New Mission — Launch submits POST /v1/missions/run (canonical Runtime contract).
 * No UI-specific execution path. Autonomy stays policy-managed.
 */
export default function NewMission() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();

  const [objective, setObjective] = useState(
    'Generate qualified business-funding opportunities',
  );
  const [workflowId, setWorkflowId] = useState(REVENUE_PRODUCTION_V1.id);
  const [budget, setBudget] = useState('10');
  const [leadEmail, setLeadEmail] = useState('');
  const [missionName, setMissionName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = useMemo(
    () => WORKFLOW_TEMPLATES.find((t) => t.id === workflowId) ?? REVENUE_PRODUCTION_V1,
    [workflowId],
  );

  async function onLaunch(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const budgetNum = Number(budget);
    const costBudget =
      Number.isFinite(budgetNum) && budgetNum >= 0 ? budgetNum : undefined;

    const stamp = Date.now();
    const actorId = mintId('act');
    const agentId = mintId('agt');

    const actor = {
      actorType: 'agent' as const,
      actorId,
      agentId,
      name: 'OL-001 Revenue Operator',
      purpose: 'OL-001 revenue production loop via Operator Console',
      owner: 'aion-operator-console',
      domain: 'revenue',
      role: 'copilot',
      tenantId,
      companyId: 'co_aion',
      permissions: template.permissions,
      maxRiskLevel: 'R3',
      autonomyLevel: 'L2',
      ...(costBudget !== undefined ? { costBudget } : {}),
      metadata: {
        launchedFrom: 'operator-console',
        cohort: 'OL-001',
        workflowTemplateId: template.id,
      },
    };

    const name =
      missionName.trim() ||
      `OL-001 · ${template.label} · ${new Date(stamp).toISOString().slice(0, 16)}`;

    const body: Record<string, unknown> = {
      actor,
      requestIdPrefix: `ol001-${stamp}`,
      mission: {
        name,
        owner: template.owner,
        objective: objective.trim() || 'Revenue production',
        status: 'active',
        riskLevel: 'R1',
        metadata: {
          cohort: 'OL-001',
          workflowTemplateId: template.id,
          workflowVersion: template.version,
          budgetUnits: costBudget ?? null,
          autonomy: 'policy-managed',
        },
      },
      workflow: {
        name: template.label,
        version: template.version,
        description: template.description,
        steps: template.steps,
        metadata: {
          templateId: template.id,
          cohort: 'OL-001',
        },
      },
      metadata: {
        cohort: 'OL-001',
        source: 'operator-console',
      },
    };

    if (leadEmail.trim()) {
      body.stepPayloads = {
        'ghl-upsert': {
          provider: 'ghl',
          contact: { email: leadEmail.trim(), source: 'aion-ol001' },
        },
      };
    } else {
      body.stepPayloads = {
        'ghl-upsert': {
          provider: 'ghl',
          contact: {
            email: `ol001-${stamp}@example.invalid`,
            source: 'aion-ol001',
          },
        },
      };
    }

    try {
      const res = await RuntimeApi.runMission(tenantId, body);
      const missionId = res.mission?.missionId;
      if (missionId) {
        navigate(`/missions/${missionId}`);
        return;
      }
      navigate('/missions');
    } catch (err: unknown) {
      const msg =
        err instanceof RuntimeHttpError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Launch failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <div className="mb-6 text-sm">
        <Link to="/missions" className="text-muted-foreground hover:text-foreground">
          ← Mission Control
        </Link>
      </div>

      <header className="mb-8 animate-fade-up">
        <p className="text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
          UX-001 · New Mission
        </p>
        <h1 className="mt-2 font-display text-4xl md:text-5xl font-semibold tracking-tight">
          Launch
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Submits the canonical <span className="font-mono text-xs">POST /v1/missions/run</span>{' '}
          contract. Autonomy stays policy-managed — this form does not raise L-levels.
        </p>
      </header>

      <form
        onSubmit={(e) => void onLaunch(e)}
        className="max-w-lg space-y-5 animate-fade-up"
        style={{ animationDelay: '60ms' }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="tenant">Tenant</Label>
          <Input id="tenant" value={tenantId} readOnly className="font-mono text-xs" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="name">Mission name (optional)</Label>
          <Input
            id="name"
            value={missionName}
            onChange={(e) => setMissionName(e.target.value)}
            placeholder="Auto-named if empty"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="objective">Objective</Label>
          <Input
            id="objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label>Workflow</Label>
          <Select value={workflowId} onValueChange={setWorkflowId}>
            <SelectTrigger>
              <SelectValue placeholder="Select workflow" />
            </SelectTrigger>
            <SelectContent>
              {WORKFLOW_TEMPLATES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{template.description}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="budget">Budget (cost units)</Label>
          <Input
            id="budget"
            type="number"
            min={0}
            step={1}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Lead email (GHL upsert)</Label>
          <Input
            id="email"
            type="email"
            value={leadEmail}
            onChange={(e) => setLeadEmail(e.target.value)}
            placeholder="optional — placeholder used if empty"
          />
        </div>

        <div className="rounded-md border border-border/70 bg-card/40 px-3 py-3">
          <div className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
            Autonomy
          </div>
          <div className="mt-1 text-sm">Policy managed</div>
          <p className="mt-1 text-xs text-muted-foreground">
            M008 grants apply at Runtime. Console never bypasses risk / approval policy.
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
          {submitting ? 'Launching…' : 'Launch Mission'}
        </Button>
      </form>
    </Shell>
  );
}
