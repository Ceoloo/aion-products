import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { useTenant } from '@/hooks/useTenant';
import { COHORT_PRE_OL } from '@/lib/cohort';
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
 * This launcher submits PRE-OL validation missions (tagged pre_ol_validation) —
 * never OL-001 production cohort credit, regardless of pause state.
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

    const cohortMeta = {
      cohort: COHORT_PRE_OL,
      synthetic: false,
      productionEconomic: false,
      launchedFrom: 'operator-console',
      workflowTemplateId: template.id,
    };

    const actor = {
      actorType: 'agent' as const,
      actorId,
      agentId,
      name: 'PRE-OL Validation Operator',
      purpose: 'Pre-OL validation via Operator Console (not OL-001 production credit)',
      owner: 'aion-operator-console',
      domain: 'revenue',
      role: 'copilot',
      tenantId,
      companyId: 'co_aion',
      permissions: template.permissions,
      maxRiskLevel: 'R3',
      autonomyLevel: 'L2',
      ...(costBudget !== undefined ? { costBudget } : {}),
      metadata: cohortMeta,
    };

    const name =
      missionName.trim() ||
      `PRE-OL · ${template.label} · ${new Date(stamp).toISOString().slice(0, 16)}`;

    const body: Record<string, unknown> = {
      actor,
      requestIdPrefix: `pre-ol-${stamp}`,
      mission: {
        name,
        owner: template.owner,
        objective: objective.trim() || 'Pre-OL validation',
        status: 'active',
        riskLevel: 'R1',
        metadata: {
          ...cohortMeta,
          workflowVersion: template.version,
          budgetUnits: costBudget ?? null,
          autonomy: 'policy-managed',
          ...(template.secureAutomationStandard
            ? {
                secureAutomationStandardId:
                  template.secureAutomationStandard.standardId,
                secureAutomationStandardVersion:
                  template.secureAutomationStandard.standardVersion,
              }
            : {}),
        },
      },
      workflow: {
        name: template.label,
        version: template.version,
        description: template.description,
        steps: template.steps
          .filter((s) => !s.humanOperated)
          .map(({ name, capability, riskLevel, description }) => ({
            name,
            capability,
            riskLevel,
            description,
          })),
        metadata: {
          templateId: template.id,
          cohort: COHORT_PRE_OL,
          productionEconomic: false,
          humanOperatedSteps: template.steps
            .filter((s) => s.humanOperated)
            .map((s) => s.name),
          ...(template.secureAutomationStandard
            ? { secureAutomation: template.secureAutomationStandard }
            : {}),
        },
      },
      metadata: {
        cohort: COHORT_PRE_OL,
        productionEconomic: false,
        synthetic: false,
        source: 'operator-console',
        ...(template.secureAutomationStandard
          ? { secureAutomation: template.secureAutomationStandard }
          : {}),
      },
    };

    if (template.id === 'lead-to-appointment-v1') {
      body.stepPayloads = {
        research: { source: 'aion-l2a' },
        enrich: { source: 'aion-l2a' },
        opportunity: {
          provider: 'ghl',
          name: `L2A opportunity ${stamp}`,
          ...(leadEmail.trim() ? { contactEmail: leadEmail.trim() } : {}),
        },
        'follow-up-task': {
          provider: 'ghl',
          title: 'Book appointment (human)',
          body: 'SA-STD-001: human books appointment until crm.appointment.* is active',
        },
        'crm-note': {
          provider: 'ghl',
          body: 'Lead-to-Appointment v1 qualification note',
        },
        'draft-message': {
          provider: 'ghl',
          body: 'Draft follow-up — do not send (L2A v1 communication rules)',
        },
      };
    } else if (leadEmail.trim()) {
      body.stepPayloads = {
        'ghl-upsert': {
          provider: 'ghl',
          contact: { email: leadEmail.trim(), source: 'aion-pre-ol' },
        },
      };
    } else {
      body.stepPayloads = {
        'ghl-upsert': {
          provider: 'ghl',
          contact: {
            email: `pre-ol-${stamp}@example.invalid`,
            source: 'aion-pre-ol',
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
          UX-001 · New Mission · PRE-OL
        </p>
        <h1 className="mt-2 font-display text-4xl md:text-5xl font-semibold tracking-tight">
          Launch
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Submits the canonical <span className="font-mono text-xs">POST /v1/missions/run</span>{' '}
          contract. Launches here are tagged{' '}
          <span className="font-mono text-xs">pre_ol_validation</span> and do not count toward
          the 100-mission cohort.
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
            placeholder="PRE-OL · … (auto if empty)"
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
          {template.secureAutomationStandard && (
            <p className="text-xs text-muted-foreground">
              {template.secureAutomationStandard.standardId} v
              {template.secureAutomationStandard.standardVersion} — draft messaging only;
              appointment booking stays human-operated.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="budget">Budget (cost units)</Label>
          <Input
            id="budget"
            type="number"
            min="0"
            step="1"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">
            {template.id === 'lead-to-appointment-v1'
              ? 'Lead email (optional CRM context)'
              : 'Lead email (optional)'}
          </Label>
          <Input
            id="email"
            type="email"
            value={leadEmail}
            onChange={(e) => setLeadEmail(e.target.value)}
            placeholder="Uses placeholder @example.invalid if empty"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Launching…' : 'Launch PRE-OL mission'}
        </Button>
      </form>
    </Shell>
  );
}
