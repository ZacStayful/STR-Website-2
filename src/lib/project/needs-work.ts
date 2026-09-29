/**
 * The free "needs work" flag (Part B): read from a listing's own words —
 * title, feature bullets and, on a page read, the description — the same way
 * shortLetsPermitted is derived, and like it the text is never kept: only the
 * flag, a score and OUR OWN phrase keys are stored.
 *
 * The phrases are read in a "needs" context and sentence by sentence, so
 * "recently modernised", "no work required" or "fully refurbished" never
 * count. A listing is flagged by any phrase of weight 2 or more; weight 1
 * ("ideal for investors") only helps the ranking. Auction wording is Batch
 * 16's own flag (deal-quality/auction.ts), not this one. "Cash buyers only"
 * is an ordinary needs-work signal: never an exclusion, never a warning.
 *
 * The phrases and weights are the decided list (Q5); they live here, one
 * place, beside the patterns that read them.
 *
 * Pure: no network, no database, no server-only.
 */

export interface NeedsWorkPhrase {
  key: string;
  weight: 1 | 2 | 3;
  pattern: RegExp;
}

const WORKS = '(?:modernisation|modernization|refurbishment|renovation|updating|upgrading|improvement|restoration|repair|repairs|work|works)';
const SOME = '(?:(?:a )?(?:full|some|complete|general|extensive|total|major|significant|substantial|cosmetic|internal|further)\\s+)?';

export const NEEDS_WORK_PHRASES: readonly NeedsWorkPhrase[] = [
  { key: 'in_need_of_works', weight: 3, pattern: new RegExp(`\\bin need of ${SOME}${WORKS}\\b`, 'i') },
  { key: 'requires_works', weight: 3, pattern: new RegExp(`\\brequir(?:es|ing) ${SOME}${WORKS}\\b`, 'i') },
  { key: 'needs_works', weight: 3, pattern: new RegExp(`\\bneeds ${SOME}${WORKS}\\b`, 'i') },
  { key: 'works_project', weight: 3, pattern: /\b(?:renovation|refurbishment|modernisation|modernization|restoration|development|improvement) (?:project|opportunity)\b/i },
  { key: 'doer_upper', weight: 3, pattern: /\b(?:doer|fixer)[- ]?upper\b/i },
  { key: 'unmodernised', weight: 3, pattern: /\bun-?moderni[sz]ed\b/i },
  { key: 'tlc', weight: 3, pattern: /\bTLC\b|\btender loving care\b/ },
  { key: 'uninhabitable', weight: 3, pattern: /\buninhabitable\b|\bnot habitable\b/i },
  { key: 'no_working_room', weight: 3, pattern: /\bno (?:working|usable|functioning) (?:kitchen|bathroom)\b/i },
  { key: 'cash_buyers_only', weight: 3, pattern: /\bcash buyers? only\b|\bsuit(?:able for|s)? (?:a )?cash buyers? only\b/i },
  { key: 'unmortgageable', weight: 3, pattern: /\bun-?mortgageable\b|\bnon[- ]mortgageable\b/i },
  { key: 'cosmetic_updating', weight: 2, pattern: /\b(?:cosmetic|light) (?:updating|update|updates|refresh|modernisation|modernization|improvement|improvements|refurbishment)\b/i },
  { key: 'scope_to_improve', weight: 2, pattern: /\bscope (?:for|to) (?:improve|improvements?|moderni[sz](?:e|ation)|updat(?:e|ing)|refurbish(?:ment)?|renovat(?:e|ion))\b/i },
  { key: 'would_benefit_from', weight: 2, pattern: /\bwould benefit from (?:some |a |full |general )?(?:updating|update|moderni[sz]ation|refurbishment|renovation|improvement|redecoration|cosmetic)\b/i },
  { key: 'opportunity_to_modernise', weight: 2, pattern: /\bopportunity to (?:moderni[sz]e|refurbish|renovate|update|improve|put your (?:own )?stamp)\b/i },
  { key: 'dated', weight: 2, pattern: /\bdated (?:kitchen|bathroom|d[eé]cor|interior|throughout|fixtures|fittings|units)\b|\b(?:kitchen|bathroom|d[eé]cor|interior) (?:is |are )?(?:now )?dated\b/i },
  { key: 'ideal_for_investors', weight: 1, pattern: /\bideal (?:for |purchase for )?(?:an? )?(?:investors?|developers?|builders?|buy[- ]to[- ]let(?: investors?)?)\b/i },
  { key: 'make_it_your_own', weight: 1, pattern: /\bmake (?:it|this) your own\b|\bput your (?:own )?stamp on\b/i },
];

/** Words just before a phrase that turn it round: "no work required", "without the need for modernisation". */
const NEGATION_BEFORE = /\b(?:no|not|without|never|nor|don'?t|doesn'?t|won'?t|isn'?t|no longer)\b[^.;:!?]{0,24}$/i;
/** A sentence about work already done. */
const ALREADY_DONE = /\b(?:recently|newly|fully|completely|tastefully|beautifully|lovingly|sympathetically|extensively|professionally) (?:moderni[sz]ed|refurbished|renovated|updated|restored|upgraded)\b/i;

export interface NeedsWork {
  flag: boolean;
  /** Sum of the distinct phrases' weights. */
  score: number;
  /** Our own phrase keys, strongest first, never the listing's words. */
  phrases: string[];
}

export const NO_NEEDS_WORK: NeedsWork = { flag: false, score: 0, phrases: [] };

/** Sentences and bullets: the unit a phrase's context is read in. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s*[|•\n\r]+\s*|;\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function needsWorkFrom(...texts: (string | null | undefined)[]): NeedsWork {
  const found = new Map<string, number>();
  for (const text of texts) {
    if (!text) continue;
    for (const s of sentences(text)) {
      for (const p of NEEDS_WORK_PHRASES) {
        if (found.has(p.key)) continue;
        const m = p.pattern.exec(s);
        if (!m) continue;
        const before = s.slice(0, m.index);
        if (NEGATION_BEFORE.test(before)) continue;
        // "Fully modernised throughout, would benefit from…" still counts the
        // explicit needs phrase; the done-already words only stop the weak ones.
        if (p.weight < 3 && ALREADY_DONE.test(s)) continue;
        found.set(p.key, p.weight);
      }
    }
  }
  const phrases = [...found.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  const score = [...found.values()].reduce((a, b) => a + b, 0);
  return { flag: [...found.values()].some((w) => w >= 2), score, phrases };
}

/** The stored value, tolerant: null when there is nothing usable. */
export function parseNeedsWork(raw: unknown): NeedsWork | null {
  let o: unknown = raw;
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (typeof r.flag !== 'boolean') return null;
  const known = new Set(NEEDS_WORK_PHRASES.map((p) => p.key));
  const phrases = Array.isArray(r.phrases) ? r.phrases.filter((k): k is string => typeof k === 'string' && known.has(k)) : [];
  const score = typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : 0;
  return { flag: r.flag, score, phrases };
}

/** Two readings combined (the feed's card text, then the page's description): the stronger flag, every phrase. */
export function mergeNeedsWork(a: NeedsWork | null | undefined, b: NeedsWork | null | undefined): NeedsWork {
  if (!a) return b ?? NO_NEEDS_WORK;
  if (!b) return a;
  const weights = new Map(NEEDS_WORK_PHRASES.map((p) => [p.key, p.weight]));
  const phrases = [...new Set([...a.phrases, ...b.phrases])].sort((x, y) => (weights.get(y) ?? 0) - (weights.get(x) ?? 0) || x.localeCompare(y));
  const score = phrases.reduce((s, k) => s + (weights.get(k) ?? 0), 0);
  return { flag: a.flag || b.flag, score, phrases };
}
