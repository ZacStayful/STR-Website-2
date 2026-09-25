/**
 * A lead form's answers into Market Explorer goals.
 *
 * The Meta lead form asks four things in plain words: where, how much,
 * how many bedrooms, and buy or rent. This turns those into the goals the
 * daily pick already searches on, tolerantly: an answer it cannot read is
 * left at its default rather than failing the whole lead.
 *
 * Pure, so the mapping is tested rather than trusted.
 */
import { DEFAULT_GOALS, parseMarketGoals, type MarketGoals } from './goals.ts';
import { AREA_META, areaMetaForSlug } from './areas.ts';
import type { Budget } from './filters.ts';

export interface LeadForm {
  email?: unknown;
  phone?: unknown;
  name?: unknown;
  /** A postcode area code ("YO"), a slug ("york"), an area name ("York") or a full postcode ("YO10 4AB"). */
  area?: unknown;
  postcode?: unknown;
  /** A budget band ("200-350"), a number of pounds, or words ("under 200k", "£250,000"). */
  budget?: unknown;
  bedrooms?: unknown;
  /** "buy", "sale", "rent", "rent-to-rent", "both". */
  kind?: unknown;
  maxRentPcm?: unknown;
}

export interface LeadGoals {
  goals: MarketGoals;
  /** The postcode area to save as a searched area, when one could be read. */
  areaCode: string | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** Reads an area code from a code, slug, name or postcode. */
export function areaCodeFrom(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const upper = s.toUpperCase();
  if (/^[A-Z]{1,2}$/.test(upper) && AREA_META.some((a) => a.code === upper)) return upper;
  const pc = upper.replace(/\s+/g, '').match(/^([A-Z]{1,2})\d/);
  if (pc && AREA_META.some((a) => a.code === pc[1])) return pc[1];
  const slug = areaMetaForSlug(s.toLowerCase().replace(/\s+/g, '-'));
  if (slug && AREA_META.some((a) => a.code === slug.code)) return slug.code;
  const byName = AREA_META.find((a) => a.name.toLowerCase() === s.toLowerCase());
  return byName?.code ?? null;
}

/** A budget band from a band code, a number of pounds, or words. */
export function budgetFrom(v: unknown): Exclude<Budget, 'any'> | null {
  const s = str(v).toLowerCase();
  if (!s) return null;
  if (s === 'u200' || s === '200-350' || s === '350-500' || s === '500+') return s;
  const nums = s.replace(/,/g, '').match(/\d+(?:\.\d+)?\s*k?/g) ?? [];
  const pounds = nums.map((n) => {
    const k = /k$/.test(n.replace(/\s/g, ''));
    const value = Number(n.replace(/[^\d.]/g, ''));
    return k || value < 10_000 ? value * 1000 : value;
  }).filter((n) => Number.isFinite(n) && n > 0);
  if (pounds.length === 0) return null;
  const top = Math.max(...pounds);
  if (/under|below|less|up to|max/.test(s) || pounds.length === 1) {
    if (top <= 200_000) return 'u200';
    if (top <= 350_000) return '200-350';
    if (top <= 500_000) return '350-500';
    return '500+';
  }
  const low = Math.min(...pounds);
  if (top <= 200_000) return 'u200';
  if (low >= 500_000) return '500+';
  if (low >= 350_000) return '350-500';
  if (low >= 200_000) return '200-350';
  return top <= 350_000 ? '200-350' : '350-500';
}

export function bedroomsFrom(v: unknown): 1 | 2 | 3 | 4 | null {
  const s = str(v);
  const n = Number(s.replace(/[^\d]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 4 ? 4 : (n as 1 | 2 | 3);
}

export function kindFrom(v: unknown): MarketGoals['sourcingKind'] {
  const s = str(v).toLowerCase();
  if (/both|either|open/.test(s)) return 'both';
  if (/rent/.test(s)) return 'rent';
  return 'sale';
}

export function parseLeadGoals(form: LeadForm): LeadGoals {
  const areaCode = areaCodeFrom(form.area) ?? areaCodeFrom(form.postcode);
  const postcode = str(form.postcode);
  const home = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(postcode) ? { postcode: postcode.toUpperCase(), lat: null, lng: null } : null;
  const maxRent = Number(str(form.maxRentPcm).replace(/[^\d.]/g, ''));
  const goals = parseMarketGoals({
    ...DEFAULT_GOALS,
    home,
    maxDistanceMiles: home ? 25 : null,
    budget: budgetFrom(form.budget),
    bedrooms: bedroomsFrom(form.bedrooms),
    sourcingKind: kindFrom(form.kind),
    maxRentPcm: Number.isFinite(maxRent) && maxRent > 0 ? Math.round(maxRent) : null,
  }) ?? DEFAULT_GOALS;
  return { goals, areaCode };
}
