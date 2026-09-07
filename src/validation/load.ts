/**
 * Real-call intake loader.
 *
 * Loads labeled real conversations from the intake directory
 * (`validation/real-calls/`), where each `*.call.ts` module exports a
 * `ValidationCall` as `call`. Files whose names start with `_` (e.g. the
 * committed `_template.call.ts`) are skipped, and real call data is gitignored
 * so PII never lands in the repo (see validation/real-calls/README.md).
 *
 * On a clean checkout / CI the directory contains only the template, so this
 * returns `[]` — which the harness correctly reports as "0 / 25, not yet
 * validated" rather than a false pass.
 */

import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ValidationCall } from './types.ts';

/** Default intake directory, relative to the repo root (process cwd). */
export const DEFAULT_INTAKE_DIR = 'validation/real-calls';

function isCallModule(name: string): boolean {
  return name.endsWith('.call.ts') && !name.startsWith('_');
}

/**
 * Dynamically imports every real-call module in `dir`. Returns an empty array if
 * the directory is missing or contains no eligible modules.
 */
export async function loadRealCalls(
  dir: string = DEFAULT_INTAKE_DIR,
): Promise<ValidationCall[]> {
  const abs = resolve(process.cwd(), dir);

  let entries: string[];
  try {
    entries = await readdir(abs);
  } catch {
    return [];
  }

  const files = entries.filter(isCallModule).sort();
  const calls: ValidationCall[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(abs, file)).href)) as {
      call?: ValidationCall;
      default?: ValidationCall;
    };
    const call = mod.call ?? mod.default;
    if (!call) {
      throw new Error(
        `Intake module "${file}" must export a ValidationCall as \`call\` (or default).`,
      );
    }
    calls.push(call);
  }
  return calls;
}
