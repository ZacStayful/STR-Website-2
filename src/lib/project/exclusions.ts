/**
 * What rules a listing out of Project deals before anything is spent (Part
 * B, decided): non-standard construction, a lease under 80 years, a listed
 * building, a conservation area, and (Q14) structural red flags. Read from
 * what the parsers already capture (yearsRemainingOnLease, features, a
 * portal's listed flag) and the listing's own words, never stored.
 *
 * "Cash buyers only" is NOT excluded and gets no warning: it is an ordinary
 * needs-work signal (needs-work.ts).
 *
 * The construction names need context ("Cornish unit", "Airey house"): read
 * bare, "Cornish" and "Unity" are a coast and a street. BISF, PRC, mundic and
 * "no-fines" are distinctive enough alone.
 *
 * Pure: no network, no database, no server-only.
 */

export type ExclusionReason = 'non_standard' | 'short_lease' | 'listed' | 'conservation' | 'structural';

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  non_standard: 'Non-standard construction',
  short_lease: 'Lease under 80 years',
  listed: 'Listed building',
  conservation: 'Conservation area',
  structural: 'Structural red flag',
};

/** A lease shorter than this rules a listing out (decided). */
export const MIN_LEASE_YEARS = 80;

/**
 * Every named system needs a construction word beside it: bare, "Unity
 * House" is a block of flats, "Wates" a builder, "Reema" a first name and
 * "Cornish" a coast.
 */
const NAMED_SYSTEMS = '(?:airey|cornish|reema|orlit|woolaway|unity|dorran|tarran|hawksley)';
const SYSTEM_WORD = '(?:type|unit|system|construction|built|design)';
const NON_STANDARD: RegExp[] = [
  /\bnon[- ]?standard (?:construction|build|built|method|type|property)\b/i,
  /\bB\.?I\.?S\.?F\b/,
  /\bP\.?R\.?C\b/,
  new RegExp(`\\b${NAMED_SYSTEMS}[- ]${SYSTEM_WORD}\\b`, 'i'),
  // Wates also builds ordinary homes ("built by Wates Construction"): only its system counts.
  /\bwates[- ](?:type|system)\b/i,
  /\b(?:airey|reema|orlit|woolaway) (?:house|home|property|bungalow)\b/i,
  /\bno[- ]fines\b/i,
  /\bprefab(?:ricated)? (?:house|home|bungalow|construction|build|property|dwelling)\b/i,
  /\bsystem[- ]built\b/i,
  /\bsteel[- ]frame(?:d)? (?:construction|house|home|property|build|building)\b/i,
  /\bconcrete (?:panel|frame(?:d)?) (?:construction|house|home|property|build)\b|\bpre[- ]?cast (?:reinforced )?concrete\b/i,
  /\bmundic\b/i,
];
const LISTED: RegExp[] = [/\bgrade (?:i{1,2}|1|2)\*? listed\b/i, /\blisted (?:building|property|cottage|house|home|farmhouse|status)\b/i, /\b(?:is|being) (?:a )?listed\b/i];
const CONSERVATION: RegExp[] = [/\bconservation area\b/i];
const STRUCTURAL: RegExp[] = [
  /\bsubsidence\b/i,
  /\bunderpinn(?:ed|ing)\b/i,
  /\bstructural (?:movement|defects?|issues?|problems?|damage|repairs?|concerns?|failure)\b/i,
  /\bjapanese knotweed\b/i,
  /\b(?:fire|flood) damage(?:d)?\b/i,
  /\bheave\b/i,
];

const NEGATION_BEFORE = /\b(?:no|not|without|never|nor|isn'?t|free (?:of|from))\b[^.;:!?]{0,24}$/i;

function firstHit(patterns: readonly RegExp[], sentencesList: readonly string[]): boolean {
  for (const s of sentencesList) {
    for (const p of patterns) {
      const m = p.exec(s);
      if (m && !NEGATION_BEFORE.test(s.slice(0, m.index))) return true;
    }
  }
  return false;
}

function sentences(texts: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const s of t.split(/(?<=[.!?])\s+|\s*[|•\n\r]+\s*|;\s+/)) if (s.trim()) out.push(s.trim());
  }
  return out;
}

export interface ExclusionInput {
  /** Title, features and, on a page read, the description. Read, never kept. */
  texts: readonly (string | null | undefined)[];
  tenure?: string | null;
  yearsRemainingOnLease?: number | null;
  /** A portal's own listed-building flag, when it gives one. */
  listedFlag?: boolean | null;
}

/** The first reason that rules it out, or null. */
export function exclusionFor(input: ExclusionInput): ExclusionReason | null {
  const years = input.yearsRemainingOnLease;
  if (typeof years === 'number' && Number.isFinite(years) && years > 0 && years < MIN_LEASE_YEARS) return 'short_lease';
  const s = sentences(input.texts);
  if (firstHit(NON_STANDARD, s)) return 'non_standard';
  if (input.listedFlag === true || firstHit(LISTED, s)) return 'listed';
  if (firstHit(CONSERVATION, s)) return 'conservation';
  if (firstHit(STRUCTURAL, s)) return 'structural';
  return null;
}
