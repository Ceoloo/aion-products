/**
 * MISSION-001 Production readiness — the preflight that decides whether the
 * Revenue Copilot is safe to ingest a REAL sales conversation.
 *
 * The decision logic (`evaluateReadiness`) is a pure function of gathered facts
 * so it can be unit-tested; `gatherReadiness` performs the IO (filesystem,
 * env, @aion/core resolution) and delegates to it. The same report backs both
 * the `preflight` CLI and the `/api/health` route.
 */

import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

import { listSchemas } from '../config/registry.ts';

export type ReadinessLevel = 'ok' | 'warn' | 'blocker';

export interface ReadinessCheck {
  id: string;
  level: ReadinessLevel;
  title: string;
  detail: string;
}

export interface ReadinessInputs {
  nodeVersion: string; // process.versions.node, e.g. "22.22.2"
  coreResolved: boolean; // @aion/core imported cleanly
  schemaCount: number; // registered SalesSchemas
  hasApiKey: boolean; // ANTHROPIC_API_KEY present → governed Claude path
  host: string; // AION_HOST bind address
  hasToken: boolean; // AION_TOKEN set
  dataDirResolved: string;
  dataDirInsideRepo: boolean;
  dataDirIsDefaultIgnored: boolean; // resolves to the git-ignored <repo>/data
  dataDirWritable: boolean;
  webBuilt: boolean; // web/dist/index.html present (shadcn SPA); else console.html fallback
}

export interface ReadinessReport {
  checks: ReadinessCheck[];
  /** No blocker-level checks — safe to run a real call. */
  ready: boolean;
  /** Which interpretation path a new session will use. */
  aiPath: 'claude' | 'deterministic';
}

const MIN_NODE = { major: 22, minor: 18 };

function nodeMeetsMinimum(version: string): boolean {
  const [maj, min] = version.split('.').map((n) => parseInt(n, 10));
  if (!Number.isFinite(maj) || !Number.isFinite(min)) return false;
  return maj! > MIN_NODE.major || (maj === MIN_NODE.major && min! >= MIN_NODE.minor);
}

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
export function isLoopback(host: string): boolean {
  return loopbackHosts.has(host);
}

/**
 * Decide production readiness from gathered facts. Blockers make it unsafe to
 * ingest a real call (can't run, or would leak/lose PII); warnings are things
 * the operator should know but that don't stop a first call.
 */
export function evaluateReadiness(i: ReadinessInputs): ReadinessReport {
  const checks: ReadinessCheck[] = [];
  const aiPath: 'claude' | 'deterministic' = i.hasApiKey ? 'claude' : 'deterministic';

  checks.push(
    nodeMeetsMinimum(i.nodeVersion)
      ? { id: 'node', level: 'ok', title: 'Node runtime', detail: `Node ${i.nodeVersion} (native TypeScript type-stripping)` }
      : { id: 'node', level: 'blocker', title: 'Node runtime', detail: `Node ${i.nodeVersion} is below the required 22.18 (TS type-stripping).` },
  );

  checks.push(
    i.coreResolved
      ? { id: 'core', level: 'ok', title: 'Canonical @aion/core', detail: 'Control plane resolved; every AI step is governed.' }
      : { id: 'core', level: 'blocker', title: 'Canonical @aion/core', detail: 'Could not resolve @aion/core. Run `npm run setup:core`.' },
  );

  checks.push(
    i.schemaCount > 0
      ? { id: 'schemas', level: 'ok', title: 'Sales schemas', detail: `${i.schemaCount} industry schema(s) registered.` }
      : { id: 'schemas', level: 'blocker', title: 'Sales schemas', detail: 'No schemas registered — nothing to run a call against.' },
  );

  checks.push(
    i.hasApiKey
      ? { id: 'ai-path', level: 'ok', title: 'Interpretation path', detail: 'ANTHROPIC_API_KEY set — the governed Claude path is active.' }
      : {
          id: 'ai-path',
          level: 'warn',
          title: 'Interpretation path',
          detail: 'No ANTHROPIC_API_KEY — the governed DETERMINISTIC path will run. Real-call validation should exercise the Claude path; set the key unless you intend to validate deterministic.',
        },
  );

  // PII safety: real records must never be committable, and the dir must be writable.
  if (!i.dataDirWritable) {
    checks.push({ id: 'data-dir', level: 'blocker', title: 'Data directory', detail: `Cannot write to ${i.dataDirResolved}.` });
  } else if (i.dataDirInsideRepo && !i.dataDirIsDefaultIgnored) {
    checks.push({
      id: 'data-dir',
      level: 'blocker',
      title: 'Data directory',
      detail: `${i.dataDirResolved} is inside the repo but not the git-ignored 'data/' path — real PII could be committed. Point AION_DATA_DIR outside the repo.`,
    });
  } else {
    checks.push({
      id: 'data-dir',
      level: 'ok',
      title: 'Data directory',
      detail: `${i.dataDirResolved} (writable, ${i.dataDirIsDefaultIgnored ? 'git-ignored default' : 'outside the repo'}).`,
    });
  }

  // Network exposure of the unauthenticated-by-default PII routes.
  if (!isLoopback(i.host) && !i.hasToken) {
    checks.push({
      id: 'network',
      level: 'blocker',
      title: 'Network exposure',
      detail: `Bound to ${i.host} without AION_TOKEN — PII routes would be reachable on the network. Set AION_TOKEN and open with #token=.`,
    });
  } else if (!isLoopback(i.host)) {
    checks.push({
      id: 'network',
      level: 'warn',
      title: 'Network exposure',
      detail: `Bound to ${i.host} with a token. Ensure this is a trusted network; the token is sent only in the x-aion-token header.`,
    });
  } else {
    checks.push({ id: 'network', level: 'ok', title: 'Network exposure', detail: 'Bound to loopback — reachable only from this machine.' });
  }

  checks.push(
    i.webBuilt
      ? { id: 'console', level: 'ok', title: 'Operator console', detail: 'Built shadcn SPA (web/dist) will be served.' }
      : { id: 'console', level: 'warn', title: 'Operator console', detail: 'web/dist not built — the dependency-free fallback console will be served. Run `npm run web:build` for the full UI.' },
  );

  return { checks, ready: !checks.some((c) => c.level === 'blocker'), aiPath };
}

/** True if the @aion/core control plane can be imported. */
async function canResolveCore(): Promise<boolean> {
  try {
    await import('@aion/core');
    return true;
  } catch {
    return false;
  }
}

async function isWritable(dir: string): Promise<boolean> {
  const probe = join(dir, `.readiness-probe-${process.pid}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

export interface GatherOptions {
  host?: string;
  token?: string;
  dataDir?: string;
  apiKey?: string;
}

/** Gather the live facts (env + filesystem + core) and evaluate readiness. */
export async function gatherReadiness(opts: GatherOptions = {}): Promise<ReadinessReport> {
  const here = dirname(fileURLToPath(import.meta.url)); // src/validation
  const repoRoot = resolve(here, '..', '..');
  const webDistIndex = join(repoRoot, 'web', 'dist', 'index.html');

  const host = opts.host ?? process.env.AION_HOST ?? '127.0.0.1';
  const token = (opts.token ?? process.env.AION_TOKEN ?? '').trim();
  const apiKey = (opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '').trim();
  const dataDirResolved = resolve(opts.dataDir ?? process.env.AION_DATA_DIR ?? join(process.cwd(), 'data'));

  const dataDirInsideRepo = dataDirResolved === repoRoot || dataDirResolved.startsWith(repoRoot + sep);
  const dataDirIsDefaultIgnored = dataDirResolved === resolve(repoRoot, 'data');

  const [coreResolved, dataDirWritable, webBuilt] = await Promise.all([
    canResolveCore(),
    isWritable(dataDirResolved),
    exists(webDistIndex),
  ]);

  return evaluateReadiness({
    nodeVersion: process.versions.node,
    coreResolved,
    schemaCount: listSchemas().length,
    hasApiKey: apiKey.length > 0,
    host,
    hasToken: token.length > 0,
    dataDirResolved,
    dataDirInsideRepo,
    dataDirIsDefaultIgnored,
    dataDirWritable,
    webBuilt,
  });
}
