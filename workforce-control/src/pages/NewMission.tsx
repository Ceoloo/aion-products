import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { useTenant } from '@/hooks/useTenant';
import { COHORT_OL001, COHORT_PRE_OL } from '@/lib/cohort';
import { RuntimeApi, RuntimeHttpError } from '@/lib/runtime-api';
import type { RegisteredAgent } from '@/lib/types';
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

/** Fixture values are available only for PRE-OL validation. */
export const SAMPLE_CLIENT_M001 = {
  clientName: 'Example Client',
  leadName: 'Sample Lead',
  contactId: 'fixture_contact_0001',
  opportunityId: 'fixture_opportunity_0001',
  pipelineId: 'fixture_stage_0001',
  stageId: 'fixture_stage_0001',
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
  const [clientName, setClientName] = useState('');
  const [leadName, setLeadName] = useState('');
  const [contactId, setContactId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [registeredAgents, setRegisteredAgents] = useState<RegisteredAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [missionName, setMissionName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isProduction = launchMode === 'ol001_production';

  useEffect(() => {
    let cancelled = false;
    RuntimeApi.listAgents(tenantId)
      .then(({ agents }) => { if (!cancelled) setRegisteredAgents(agents); })
      .catch((err: unknown) => {
        if (!cancelled) setAgentsError(err instanceof Error ? err.message : 'Could not load agents');
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  const template = useMemo(
    () => WORKFLOW_TEMPLATES.find((t) => t.id === workflowId) ?? REVENUE_PRODUCTION_V1,
    [workflowId],
  );
  const automatedSteps = useMemo(() => {
    const configured = template.steps.filter((step) => !step.humanOperated);
    return isProduction && template.id === LEAD_TO_APPOINTMENT_V1.id
      ? [
          { name: 'contact-read', capability: 'crm.contact.read', riskLevel: 'R1' as const,
            description: 'Read the real GHL contact before proposing the opportunity action' },
          ...configured.filter((step) => step.name !== 'research' && step.name !== 'enrich'),
        ]
      : configured;
  }, [template, isProduction]);
  const eligibleAgents = useMemo(() => {
    const capabilities = automatedSteps.map((step) =>
      step.name === 'opportunity' && isProduction && opportunityId.trim()
        ? 'crm.opportunity.update' : step.capability);
    return registeredAgents.filter((agent) =>
      capabilities.every((capability) => agent.permissions.includes(capability)) &&
      (agent.maxRiskLevel === undefined || ['R2', 'R3'].includes(agent.maxRiskLevel)));
  }, [registeredAgents, automatedSteps, isProduction, opportunityId]);

  function applySamplePreset() {
    setLaunchMode('pre_ol');
    setProductionConfirm(false);
    setWorkflowId(LEAD_TO_APPOINTMENT_V1.id);
    setMissionName(
      `PRE-OL · ${SAMPLE_CLIENT_M001.clientName} · ${SAMPLE_CLIENT_M001.leadName}`,
    );
    setObjective(
      `Validate the lead-to-appointment flow with the ${SAMPLE_CLIENT_M001.leadName} fixture`,
    );
    setBudget('25');
    setLeadEmail('');
    setClientName(SAMPLE_CLIENT_M001.clientName);
    setLeadName(SAMPLE_CLIENT_M001.leadName);
    setContactId(SAMPLE_CLIENT_M001.contactId);
    setOpportunityId(SAMPLE_CLIENT_M001.opportunityId);
    setPipelineId(SAMPLE_CLIENT_M001.pipelineId);
    setStageId(SAMPLE_CLIENT_M001.stageId);
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
    if (isProduction && template.id !== LEAD_TO_APPOINTMENT_V1.id) {
      setError('Production Operator Loop requires the approval-gated Lead-to-Appointment workflow.');
      return;
    }
    if (isProduction && (!clientName.trim() || !leadName.trim() || !contactId.trim() || !pipelineId.trim() || !stageId.trim())) {
      setError('Production requires a client, lead, GHL contact, pipeline and stage.');
      return;
    }
    if (isProduction && (
      contactId.trim() === SAMPLE_CLIENT_M001.contactId ||
      opportunityId.trim() === SAMPLE_CLIENT_M001.opportunityId ||
      leadEmail.endsWith('@example.invalid')
    )) {
      setError('Fixture identifiers and example.invalid email cannot be used for a production mission.');
      return;
    }
    const selectedAgent = eligibleAgents.find((agent) => agent.actorId === selectedAgentId);
    if (isProduction && !selectedAgent) {
      setError('Select a registered tenant agent with every workflow capability and an R2 risk ceiling.');
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
      automatedStepCount: automatedSteps.length,
      retryCount: 0,
    };

    if (isProduction) {
      cohortMeta.cohortTarget = SAMPLE_CLIENT_M001.cohortTarget;
      cohortMeta.clientName = clientName.trim();
      cohortMeta.leadName = leadName.trim();
      cohortMeta.ghlContactId = contactId.trim();
      if (opportunityId.trim()) cohortMeta.ghlOpportunityId = opportunityId.trim();
    }

    const draftActor = {
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
    const actor = isProduction ? selectedAgent! : draftActor;

    const name =
      missionName.trim() ||
      (isProduction
        ? `OL-001 · ${clientName.trim()} · ${leadName.trim()} · ${new Date(stamp).toISOString().slice(0, 16)}`
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
        steps: automatedSteps
          .map(({ name: stepName, capability, riskLevel, description }) => {
            // Entity-state: existing opportunityId → update, else create.
            const resolvedCapability =
              stepName === 'opportunity' &&
              capability === 'crm.opportunity.create' &&
              isProduction &&
              opportunityId.trim()
                ? 'crm.opportunity.update'
                : capability;
            return {
              name: stepName,
              capability: resolvedCapability,
              riskLevel,
              description,
            };
          }),
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
        operatorLoopAutoContinue: true,
        ...(isProduction
          ? {
              clientName: clientName.trim(),
              ghlContactId: contactId.trim(),
              ...(opportunityId.trim() ? { ghlOpportunityId: opportunityId.trim() } : {}),
            }
          : {}),
        ...(template.secureAutomationStandard
          ? { secureAutomation: template.secureAutomationStandard }
          : {}),
      },
    };

    if (template.id === 'lead-to-appointment-v1') {
      body.stepPayloads = {
        ...(isProduction ? { 'contact-read': { provider: 'ghl', contactId: contactId.trim() } } : {}),
        ...(!isProduction ? {
          research: { source: 'aion-l2a' },
          enrich: { source: 'aion-l2a' },
        } : {}),
        opportunity: {
          provider: 'ghl',
          name: isProduction
            ? `${clientName.trim()} · ${leadName.trim()}`
            : `L2A opportunity ${stamp}`,
          ...(isProduction
            ? {
                contactId: contactId.trim(),
                ...(opportunityId.trim() ? { opportunityId: opportunityId.trim() } : {}),
                pipelineId: pipelineId.trim(),
                stage: stageId.trim(),
                stageId: stageId.trim(),
                status: 'open',
              }
            : {}),
          ...(leadEmail.trim() ? { contactEmail: leadEmail.trim() } : {}),
        },
        'follow-up-task': {
          provider: 'ghl',
          title: isProduction
            ? `Book appointment — ${leadName.trim()}`
            : 'Book appointment (human)',
          body: 'SA-STD-001: human books appointment until crm.appointment.* is active',
          // GHL contact tasks require dueDate.
          dueDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          ...(isProduction ? { contactId: contactId.trim() } : {}),
        },
        'crm-note': {
          provider: 'ghl',
          body: isProduction
            ? `OL-001 · ${clientName.trim()} · ${leadName.trim()} — qualification note`
            : 'Lead-to-Appointment v1 qualification note',
          ...(isProduction ? { contactId: contactId.trim() } : {}),
        },
        'draft-message': {
          provider: 'ghl',
          body: isProduction
            ? `Draft follow-up for ${leadName.trim()} — do not send (OL-001 L2A rules)`
            : 'Draft follow-up — do not send (L2A v1 communication rules)',
          ...(isProduction ? { contactId: contactId.trim() } : {}),
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
                  firstName: leadName.trim().split(' ')[0] ?? leadName.trim(),
                  lastName: leadName.trim().split(' ').slice(1).join(' '),
                  contactId: contactId.trim(),
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
              onClick={() => {
                setLaunchMode('ol001_production');
                setWorkflowId(LEAD_TO_APPOINTMENT_V1.id);
              }}
            >
              OL-001 Production
            </Button>
            <Button type="button" variant="secondary" onClick={applySamplePreset}>
              PRE-OL fixture preset
            </Button>
          </div>
          {isProduction ? (
            <div className="space-y-2 pt-1">
              <p className="text-xs text-muted-foreground">
                Tags <span className="font-mono">cohort=OL-001</span> and{' '}
                <span className="font-mono">productionEconomic=true</span>. Counts as{' '}
                <span className="font-mono">
                OL-001 / {SAMPLE_CLIENT_M001.cohortTarget}
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

        {isProduction && (
          <div className="space-y-1.5">
            <Label>Registered agent</Label>
            <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
              <SelectTrigger><SelectValue placeholder="Choose a tenant agent" /></SelectTrigger>
              <SelectContent>
                {eligibleAgents.map((agent) => (
                  <SelectItem key={agent.actorId} value={agent.actorId}>
                    {agent.name} · {agent.actorId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {agentsError && <p className="text-xs text-destructive">{agentsError}</p>}
            {!agentsError && eligibleAgents.length === 0 && (
              <p className="text-xs text-muted-foreground">No registered agent has every required capability. Provision one before launch.</p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="name">Mission name {isProduction ? '' : '(optional)'}</Label>
          <Input
            id="name"
            value={missionName}
            onChange={(e) => setMissionName(e.target.value)}
            placeholder={
              isProduction
                ? 'OL-001 · Client · Lead'
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
                ? 'Real lead email'
                : 'Uses placeholder @example.invalid if empty'
            }
            required={isProduction}
          />
        </div>

        {isProduction && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Real GHL record for this mission. The operator will review the proposed opportunity action before it runs.</p>
            {([
              ['Client name', clientName, setClientName],
              ['Lead name', leadName, setLeadName],
              ['GHL contact ID', contactId, setContactId],
              ['GHL pipeline ID', pipelineId, setPipelineId],
              ['GHL stage ID', stageId, setStageId],
            ] as const).map(([label, value, setter]) => (
              <label key={label} className="block text-xs text-muted-foreground">
                {label}
                <Input className="mt-1 font-mono text-xs" value={value} onChange={(e) => setter(e.target.value)} required />
              </label>
            ))}
            <label className="block text-xs text-muted-foreground">
              Existing GHL opportunity ID (optional; leave blank to create)
              <Input className="mt-1 font-mono text-xs" value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)} />
            </label>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting || (isProduction && !productionConfirm)}>
          {submitting
            ? 'Launching…'
            : isProduction
              ? 'Launch OL-001 Production'
              : 'Launch PRE-OL mission'}
        </Button>
      </form>
    </Shell>
  );
}
