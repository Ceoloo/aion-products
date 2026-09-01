/**
 * Industry schema registry. Adding a new vertical is a matter of dropping a
 * SalesSchema here — the engines do not change.
 */

import type { SalesSchema } from './schema.ts';
import { fundingSchema } from './industries/funding.ts';
import { aionB2bSchema } from './industries/aion-b2b.ts';
import { contractorSchema } from './industries/contractor.ts';

const SCHEMAS: Record<string, SalesSchema> = {
  [fundingSchema.key]: fundingSchema,
  [aionB2bSchema.key]: aionB2bSchema,
  [contractorSchema.key]: contractorSchema,
};

export function getSchema(key: string): SalesSchema {
  const s = SCHEMAS[key];
  if (!s) {
    throw new Error(`Unknown industry schema "${key}". Known: ${Object.keys(SCHEMAS).join(', ')}`);
  }
  return s;
}

export function listSchemas(): SalesSchema[] {
  return Object.values(SCHEMAS);
}

export { fundingSchema, aionB2bSchema, contractorSchema };
