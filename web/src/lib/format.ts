export const OUTCOMES = [
  'no_contact', 'engaged', 'qualified', 'follow_up', 'application',
  'appointment', 'proposal', 'demo', 'other_conversion', 'closed', 'disqualified',
] as const;

export const DISPOSITIONS = [
  'conversation', 'gatekeeper', 'instant_rejection', 'bad_timing',
  'existing_provider', 'rate_first', 'callback', 'no_contact', 'other',
] as const;

export const DOWNSTREAM = [
  '', 'application', 'appointment', 'proposal', 'demo', 'closed', 'other_conversion',
] as const;

export const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
