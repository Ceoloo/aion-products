import type { CallFixture } from './types.ts';
import { fundingDiscoveryCall } from './funding-discovery-call.ts';
import { fundingWarmFollowupCall } from './funding-warm-followup-call.ts';
import { fundingBrushoffCall } from './funding-brushoff-call.ts';
import { contractorEstimateCall } from './contractor-estimate-call.ts';
import { aionB2bDiscoveryCall } from './aion-b2b-discovery-call.ts';

export const FIXTURES: CallFixture[] = [
  fundingDiscoveryCall,
  fundingWarmFollowupCall,
  fundingBrushoffCall,
  contractorEstimateCall,
  aionB2bDiscoveryCall,
];

export function getFixture(id: string): CallFixture {
  const f = FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown fixture "${id}". Known: ${FIXTURES.map((x) => x.id).join(', ')}`);
  return f;
}
