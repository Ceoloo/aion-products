/**
 * Lightweight text heuristics used by the deterministic engine paths. These are
 * intentionally simple and explainable — they are the offline baseline and the
 * fallback when the LLM is unavailable, not the ceiling of the product.
 */

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
}

export function containsAny(text: string, cues: string[]): string | null {
  const n = normalize(text);
  for (const cue of cues) {
    if (n.includes(normalize(cue))) return cue;
  }
  return null;
}

const MONEY_RE = /\$?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|thousand|m|mm|mil|million|bn|billion)?\b/gi;

function normalizeMoney(numStr: string, unitRaw: string): string | null {
  const rawNum = Number(numStr.replace(/,/g, ''));
  if (Number.isNaN(rawNum)) return null;
  const unit = unitRaw.toLowerCase();
  let value = rawNum;
  if (unit === 'k' || unit === 'thousand') value = rawNum * 1_000;
  else if (unit === 'm' || unit === 'mm' || unit === 'mil' || unit === 'million') value = rawNum * 1_000_000;
  else if (unit === 'bn' || unit === 'billion') value = rawNum * 1_000_000_000;
  // Ignore tiny bare numbers that are almost certainly not money.
  if (!unit && value < 1000) return null;
  return `$${value.toLocaleString('en-US')}`;
}

/** All money-like amounts in the text, normalized, in order. */
function allMoney(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const v = normalizeMoney(m[1] ?? '', m[2] ?? '');
    if (v) out.push(v);
  }
  return out;
}

/** Extract the first money-like amount and return a normalized string. */
export function extractMoney(text: string): string | null {
  return allMoney(text)[0] ?? null;
}

/** Extract a money range like "$75k to $100k" or "between $75k and $100k". */
export function extractMoneyRange(text: string): string | null {
  const amounts = allMoney(text);
  if (amounts.length >= 2 && amounts[0] !== amounts[1]) return `${amounts[0]}–${amounts[1]}`;
  return amounts[0] ?? null;
}

/** Extract a "time in business" style duration in years. */
export function extractYears(text: string): string | null {
  const m = normalize(text).match(/(\d+(?:\.\d+)?)\s*(year|yr|yrs|years)/);
  if (m) return `${m[1]} years`;
  const months = normalize(text).match(/(\d+)\s*(month|months|mo)/);
  if (months) return `${months[1]} months`;
  return null;
}

/** Simple sentence splitter. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Best-effort JSON extraction from an LLM response that may wrap JSON in prose or fences. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Strip ```json fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? (fenced[1] ?? '').trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the first {...} or [...] block.
    const objStart = candidate.search(/[[{]/);
    if (objStart >= 0) {
      const sliced = candidate.slice(objStart);
      // Try progressively shorter suffixes ending at a bracket.
      for (let end = sliced.length; end > 0; end--) {
        const ch = sliced[end - 1];
        if (ch === '}' || ch === ']') {
          try {
            return JSON.parse(sliced.slice(0, end));
          } catch {
            /* keep shrinking */
          }
        }
      }
    }
    throw new Error('no parseable JSON found in model output');
  }
}
