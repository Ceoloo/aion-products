import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { useTenant } from '@/hooks/useTenant';
import { COHORT_OL001, COHORT_PRE_OL } from '@/lib/cohort';
import { RuntimeApi, RuntimeHttpError } from '@/lib/runtime-api';
import {
  LEAD_TO_APPOINTMENT_V1,
  REVENUE_PRODUCTION_V1,
  WORKFLOW_TEMPLATES,
} from '@/lib/workflows';
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

/** ModernRelx / Annfiera — live GHL fixture on AION Empire (same IDs as M001). */
export const MODERNRELX_M001 = {
  clientName: 'ModernRelx',
  leadName: 'Annfiera McPherson',
  contactId: 'MyWCgeFaKnifp6LM7yIc',
  opportunityId: 'rGbIyrAvGDcmMEzjBER4',
  missionOrdinal: 1,
  cohortTarget: 100,
} as const;

type LaunchMode = 'pre_ol' | 'ol001_production';

function mintId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * New Mission — POST /v1/missions/run.
 *
 * Default: PRE-OL (excluded from 0/100). Explicit OL-001 Production mode is
 * required for scoreboard credit (cohort=OL-001 + productionEconomic=true).
 */
export default function NewMission() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();

  const [launchMode, setLaunchMode] = useState<LaunchMode>('pre_ol');
  const [productionConfirm, setProductionConfirm] = useState(false);
  const [objective, setObjective] = useState(
    'Generate qualified business-funding opportunities',
  );
  const [workflowId, setWorkflowId] = useState(REVENUE_PRODUCTION_V1.id);
  const [budget, setBudget] = useState('10');
  const [leadEmail, setLeadEmail] = useState('');
  const [missionName, setMissionName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isProduction = launchMode === 'ol001_production';

  const template = useMemo(
    () => WORKFLOW_TEMPLATES.find((t) => t.id === workflowId) ?? REVENUE_PRODUCTION_V1,
    [workflowId],
  );

  function applyModernRelxPreset() {
    setLaunchMode('ol001_production');
    setProductionConfirm(false);
    setWorkflowId(LEAD_TO_APPOINTMENT_V1.id);
    setMissionName(
      `OL-001 · M${String(MODERNRELX_M001.missionOrdinal).padStart(3, '0')} · ${MODERNRELX_M001.clientName} · ${MODERNRELX_M001.leadName}`,
    );
    setObjective(
      `Qualify and advance ${MODERNRELX_M001.leadName} (${MODERNRELX_M001.clientName}) toward a booked appointment — live GHL opportunity ${MODERNRELX_M001.opportunityId}`,
    );
    setBudget('25');
    setLeadEmail('');
    setError(null);
  }

  async function onLaunch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (isProduction && !productionConfirm) {
      setError(
        'Confirm OL-001 Production launch mode — this mission will count toward 001/100.',
      );
      return;
    }
    if (isProduction && !leadEmail.trim()) {
      setError('OL-001 Production requires a real lead email (no @example.invalid).');
      return;
    }

    setSubmitting(true);

    const budgetNum = Number(budget);
    const costBudget =
      Number.isFinite(budgetNum) && budgetNum >= 0 ? budgetNum : undefined;

    const stamp = Date.now();
    const actorId = mintId('act');
    const agentId = mintId('agt');

    const cohort = isProduction ? COHORT_OL001 : COHORT_PRE_OL;
    const productionEconomic = isProduction;

    const cohortMeta: Record<string, unknown> = {
      cohort,
      synthetic: false,
      productionEconomic,
      launchedFrom: 'operator-console',
      workflowTemplateId: template.id,
      launchMode: isProduction ? 'ol001_production' : 'pre_ol',
    };

    if (isProduction) {
      cohortMeta.missionOrdinal = MODERNRELX_M001.missionOrdinal;
      cohortMeta.cohortTarget = MODERNRELX_M001.cohortTarget;
      cohortMeta.clientName = MODERNRELX_M001.clientName;
      cohortMeta.leadName = MODERNRELX_M001.leadName;
      cohortMeta.ghlContactId = MODERNRELX_M001.contactId;
      cohortMeta.ghlOpportunityId = MODERNRELX_M001.opportunityId;
    }

    const actor = {
      actorType: 'agent' as const,
      actorId,
      agentId,
      name: isProduction
        ? 'OL-001 Production Operator'
        : 'PRE-OL Validation Operator',
      purpose: isProduction
        ? 'OL-001 production mission via Operator Console (counts toward 100)'
        : 'Pre-OL validation via Operator Console (not OL-001 production credit)',
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
      (isProduction
        ? `OL-001 · M001 · ${MODERNRELX_M001.clientName} · ${new Date(stamp).toISOString().slice(0, 16)}`
        : `PRE-OL · ${template.label} · ${new Date(stamp).toISOString().slice(0, 16)}`);

    const body: Record<string, unknown> = {
      actor,
      requestIdPrefix: isProduction ? `ol001-m001-${stamp}` : `pre-ol-${stamp}`,
      mission: {
        name,
        owner: template.owner,
        objective:
          objective.trim() ||
          (isProduction ? 'OL-001 production revenue mission' : 'Pre-OL validation'),
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
          .map(({ name: stepName, capability, riskLevel, description }) => ({
            name: stepName,
            capability,
            riskLevel,
            description,
          })),
        metadata: {
          templateId: template.id,
          cohort,
          productionEconomic,
          humanOperatedSteps: template.steps
            .filter((s) => s.humanOperated)
            .map((s) => s.name),
          ...(template.secureAutomationStandard
            ? { secureAutomation: template.secureAutomationStandard }
            : {}),
        },
      },
      metadata: {
        cohort,
        productionEconomic,
        synthetic: false,
        source: 'operator-console',
        ...(isProduction
          ? {
              clientName: MODERNRELX_M001.clientName,
              missionOrdinal: MODERNRELX_M001.missionOrdinal,
              ghlContactId: MODERNRELX_M001.contactId,
              ghlOpportunityId: MODERNRELX_M001.opportunityId,
            }
          : {}),
        ...(template.secureAutomationStandard
          ? { secureAutomation: template.secureAutomationStandard }
          : {}),
      },
    };

    if (template.id === 'lead-to-appointment-v1') {
      body.stepPayloads = {
        research: { source: isProduction ? 'aion-ol001' : 'aion-l2a' },
        enrich: { source: isProduction ? 'aion-ol001' : 'aion-l2a' },
        opportunity: {
          provider: 'ghl',
          name: isProduction
            ? `${MODERNRELX_M001.clientName} · ${MODERNRELX_M001.leadName}`
            : `L2A opportunity ${stamp}`,
          ...(isProduction
            ? {
                contactId: MODERNRELX_M001.contactId,
                opportunityId: MODERNRELX_M001.opportunityId,
              }
            : {}),
          ...(leadEmail.trim() ? { contactEmail: leadEmail.trim() } : {}),
        },
        'follow-up-task': {
          provider: 'ghl',
          title: isProduction
            ? `Book appointment — ${MODERNRELX_M001.leadName}`
            : 'Book appointment (human)',
          body: 'SA-STD-001: human books appointment until crm.appointment.* is active',
          ...(isProduction ? { contactId: MODERNRELX_M001.contactId } : {}),
        },
        'crm-note': {
          provider: 'ghl',
          body: isProduction
            ? `OL-001 M001 · ${MODERNRELX_M001.clientName} · ${MODERNRELX_M001.leadName} — qualification note`
            : 'Lead-to-Appointment v1 qualification note',
          ...(isProduction ? { contactId: MODERNRELX_M001.contactId } : {}),
        },
        'draft-message': {
          provider: 'ghl',
          body: isProduction
            ? `Draft follow-up for ${MODERNRELX_M001.leadName} — do not send (OL-001 L2A rules)`
            : 'Draft follow-up — do not send (L2A v1 communication rules)',
          ...(isProduction ? { contactId: MODERNRELX_M001.contactId } : {}),
        },
      };
    } else if (leadEmail.trim()) {
      body.stepPayloads = {
        'ghl-upsert': {
          provider: 'ghl',
          contact: {
            email: leadEmail.trim(),
            source: isProduction ? 'aion-ol001' : 'aion-pre-ol',
            ...(isProduction
              ? {
                  firstName: 'Annfiera',
                  lastName: 'McPherson',
                  contactId: MODERNRELX_M001.contactId,
                }
              : {}),
          },
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
      navigate(isProduction ? '/ol001' : '/missions');
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
          UX-001 · New Mission · {isProduction ? 'OL-001 PRODUCTION' : 'PRE-OL'}
        </p>
        <h1 className="mt-2 font-display text-4xl md:text-5xl font-semibold tracking-tight">
          Launch
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Submits <span className="font-mono text-xs">POST /v1/missions/run</span>. PRE-OL
          stays the default (excluded from 0/100). Switch to{' '}
          <strong className="text-foreground">OL-001 Production</strong> only when you intend
          scoreboard credit.
        </p>
      </header>

      <form
        onSubmit={(e) => void onLaunch(e)}
        className="max-w-lg space-y-5 animate-fade-up"
        style={{ animationDelay: '60ms' }}
      >
        <div className="space-y-2 rounded-md border border-border p-3">
          <Label>Launch mode</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant={!isProduction ? 'default' : 'outline'}
              onClick={() => {
                setLaunchMode('pre_ol');
                setProductionConfirm(false);
              }}
            >
              PRE-OL validation
            </Button>
            <Button
              type="button"
              variant={isProduction ? 'default' : 'outline'}
              onClick={() => setLaunchMode('ol001_production')}
            >
              OL-001 Production
            </Button>
            <Button type="button" variant="secondary" onClick={applyModernRelxPreset}>
              ModernRelx M001 preset
            </Button>
          </div>
          {isProduction ? (
            <div className="space-y-2 pt-1">
              <p className="text-xs text-muted-foreground">
                Tags <span className="font-mono">cohort=OL-001</span> and{' '}
                <span className="font-mono">productionEconomic=true</span>. Counts as{' '}
                <span className="font-mono">
                  M{String(MODERNRELX_M001.missionOrdinal).padStart(3, '0')} /{' '}
                  {MODERNRELX_M001.cohortTarget}
                </span>{' '}
                when Runtime accepts the run.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={productionConfirm}
                  onChange={(e) => setProductionConfirm(e.target.checked)}
                />
                <span>
                  I am launching a real OL-001 production mission (not PRE-OL). This will
                  move the scoreboard from 0/100 when successful.
                </span>
              </label>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tagged <span className="font-mono">pre_ol_validation</span> — preserved, never
              counted toward OL-001.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tenant">Tenant</Label>
          <Input id="tenant" value={tenantId} readOnly className="font-mono text-xs" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="name">Mission name {isProduction ? '' : '(optional)'}</Label>
          <Input
            id="name"
            value={missionName}
            onChange={(e) => setMissionName(e.target.value)}
            placeholder={
              isProduction
                ? 'OL-001 · M001 · ModernRelx · …'
                : 'PRE-OL · … (auto if empty)'
            }
            required={isProduction}
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
            {isProduction
              ? 'Lead email (required)'
              : template.id === 'lead-to-appointment-v1'
                ? 'Lead email (optional CRM context)'
                : 'Lead email (optional)'}
          </Label>
          <Input
            id="email"
            type="email"
            value={leadEmail}
            onChange={(e) => setLeadEmail(e.target.value)}
            placeholder={
              isProduction
                ? 'Real lead email for ModernRelx / Annfiera'
                : 'Uses placeholder @example.invalid if empty'
            }
            required={isProduction}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting || (isProduction && !productionConfirm)}>
          {submitting
            ? 'Launching…'
            : isProduction
              ? 'Launch OL-001 Production · M001'
              : 'Launch PRE-OL mission'}
        </Button>
      </form>
    </Shell>
  );
}
