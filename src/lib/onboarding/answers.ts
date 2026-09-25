/**
 * The welcome screen's three answers, read back from its form.
 *
 * Strict where a wrong value would mislead (an unreadable kind or place, a
 * rent ceiling outside the sane band, a postcode that is not one), tolerant
 * where "no answer" is a real answer (an empty budget or rent ceiling means
 * "not sure yet", which the goals store as null).
 *
 * Pure, so the mapping is tested rather than trusted.
 */
import { isSourcingKind, normalisePostcode, parseMaxRentPcm, MAX_RENT_PCM_RANGE, type MaxDistance, type SourcingKind } from '../market/goals.ts';
import { isBudget, type Budget } from '../market/filters.ts';
import { AREA_META } from '../market/areas.ts';

export type WhereChoice = 'near' | 'areas' | 'anywhere';

export interface WelcomeAnswers {
  kind: SourcingKind;
  /** Purchase budget band; null = not sure yet. Only when kind includes sale. */
  budget: Exclude<Budget, 'any'> | null;
  /** Rent-to-rent ceiling, £ pcm; null = not sure yet. Only when kind includes rent. */
  maxRentPcm: number | null;
  where: WhereChoice;
  /** Normalised home postcode, only for `near`. */
  postcode: string | null;
  /** Only for `near`. */
  maxDistanceMiles: MaxDistance | null;
  /** Postcode area codes, validated and deduplicated, only for `areas`. */
  areas: string[];
}

/** The form field names the wizard posts and the action reads. */
export const WELCOME_FIELDS = {
  kind: 'kind',
  budget: 'budget',
  maxRentPcm: 'maxRentPcm',
  where: 'where',
  postcode: 'postcode',
  maxDistanceMiles: 'maxDistanceMiles',
  /** Comma-separated area codes. */
  areas: 'areas',
  next: 'next',
} as const;

export const DISTANCE_OPTIONS: readonly MaxDistance[] = [25, 50, 100];
export const RENT_PRESETS_PCM: readonly number[] = [1000, 1500, 2000, 3000];

export const WHERE_LABELS: Record<WhereChoice, string> = {
  near: 'Near a postcode',
  areas: 'Pick specific areas',
  anywhere: 'Anywhere — show me the best',
};

const KNOWN_AREAS = new Set(AREA_META.map((a) => a.code));

export function isWhereChoice(v: unknown): v is WhereChoice {
  return v === 'near' || v === 'areas' || v === 'anywhere';
}

export function isMaxDistance(v: unknown): v is MaxDistance {
  return v === 25 || v === 50 || v === 100;
}

/** Area codes from a comma- or space-separated string; unknown codes are dropped, order kept, duplicates removed. */
export function areaCodesFrom(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const code = part.trim().toUpperCase();
    if (code && KNOWN_AREAS.has(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

export type Getter = (key: string) => string | null;

export type ParsedAnswers = { ok: true; answers: WelcomeAnswers } | { ok: false; error: string };

const fail = (error: string): ParsedAnswers => ({ ok: false, error });

export function parseWelcomeAnswers(get: Getter): ParsedAnswers {
  const F = WELCOME_FIELDS;
  const kind = get(F.kind);
  if (!isSourcingKind(kind)) return fail('Choose what you are looking for.');
  const wantsSale = kind !== 'rent';
  const wantsRent = kind !== 'sale';

  let budget: WelcomeAnswers['budget'] = null;
  if (wantsSale) {
    const b = get(F.budget);
    budget = isBudget(b) && b !== 'any' ? b : null;
  }

  let maxRentPcm: number | null = null;
  if (wantsRent) {
    const raw = (get(F.maxRentPcm) ?? '').trim();
    if (raw !== '') {
      maxRentPcm = parseMaxRentPcm(raw);
      if (maxRentPcm === null) {
        return fail(`Enter a monthly rent between £${MAX_RENT_PCM_RANGE.min} and £${MAX_RENT_PCM_RANGE.max.toLocaleString('en-GB')}, or choose "Not sure yet".`);
      }
    }
  }

  const where = get(F.where);
  if (!isWhereChoice(where)) return fail('Choose where you want to look.');

  let postcode: string | null = null;
  let maxDistanceMiles: MaxDistance | null = null;
  let areas: string[] = [];
  if (where === 'near') {
    postcode = normalisePostcode(get(F.postcode) ?? '');
    if (!postcode) return fail('Enter a full UK postcode, like NG2 5GB.');
    const md = Number(get(F.maxDistanceMiles));
    if (!isMaxDistance(md)) return fail('Choose how far you would go.');
    maxDistanceMiles = md;
  } else if (where === 'areas') {
    areas = areaCodesFrom(get(F.areas));
    if (areas.length === 0) return fail('Pick at least one area.');
  }

  return { ok: true, answers: { kind, budget, maxRentPcm, where, postcode, maxDistanceMiles, areas } };
}

/** One row of the area picker: ranked areas carry a score, the rest do not. */
export interface WelcomeArea {
  code: string;
  name: string;
  score: number | null;
}
