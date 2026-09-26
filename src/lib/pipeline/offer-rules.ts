/**
 * The offer range's discount bands: how far below the asking figure to open,
 * given how long the listing has been on the market (and, for a purchase,
 * how many times it has been reduced). A business rule, so it is stored in
 * billing_settings under OFFER_RULES_KEY and edited at /admin/offer-range,
 * never hard-coded.
 *
 * Each row reads as one sentence: "on the market at least X (and reduced at
 * least Y times) → open Z% below asking". The biggest discount among the rows
 * a listing matches wins, so row order does not matter.
 *
 * Deliberately NO default values: a missing or malformed setting hides the
 * listing-history part of the range rather than guessing it.
 *
 * Pure: no network, no database, no `server-only`.
 */

export const OFFER_RULES_KEY = 'offer_discount_bands';

export interface PurchaseRule {
  minMonths: number;
  minReductions: number;
  discountPct: number;
}

export interface RentRule {
  minWeeks: number;
  discountPct: number;
}

export interface OfferRules {
  /** Null when not set (or not valid): the purchase range then uses the target only. */
  purchase: PurchaseRule[] | null;
  rentToRent: RentRule[] | null;
}

export const NO_OFFER_RULES: OfferRules = { purchase: null, rentToRent: null };

/** Sanity limits: a value outside these is a typo, not a policy. */
export const RULE_LIMITS = { maxRows: 12, maxDiscountPct: 50, maxMonths: 120, maxWeeks: 520, maxReductions: 10 } as const;

function num(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function inRange(v: number | null, max: number, integer: boolean): v is number {
  return v !== null && v >= 0 && v <= max && (!integer || Number.isInteger(v));
}

function parsePurchase(raw: unknown): PurchaseRule[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > RULE_LIMITS.maxRows) return null;
  const out: PurchaseRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    const minMonths = num(o.minMonths);
    const minReductions = num(o.minReductions ?? 0);
    const discountPct = num(o.discountPct);
    if (!inRange(minMonths, RULE_LIMITS.maxMonths, false)) return null;
    if (!inRange(minReductions, RULE_LIMITS.maxReductions, true)) return null;
    if (!inRange(discountPct, RULE_LIMITS.maxDiscountPct, false)) return null;
    out.push({ minMonths, minReductions, discountPct });
  }
  return out;
}

function parseRent(raw: unknown): RentRule[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > RULE_LIMITS.maxRows) return null;
  const out: RentRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    const minWeeks = num(o.minWeeks);
    const discountPct = num(o.discountPct);
    if (!inRange(minWeeks, RULE_LIMITS.maxWeeks, false)) return null;
    if (!inRange(discountPct, RULE_LIMITS.maxDiscountPct, false)) return null;
    out.push({ minWeeks, discountPct });
  }
  return out;
}

/** A stored setting back into rules. Each kind stands or falls on its own. */
export function parseOfferRules(raw: unknown): OfferRules {
  if (!raw || typeof raw !== 'object') return NO_OFFER_RULES;
  const o = raw as Record<string, unknown>;
  return { purchase: parsePurchase(o.purchase), rentToRent: parseRent(o.rentToRent) };
}

const DAYS_PER_MONTH = 30.44;

/**
 * The discount for a listing, as a percentage, or null when no row matches
 * or the rules are not set. An unknown age matches nothing.
 */
export function purchaseDiscount(rules: PurchaseRule[] | null, ageDays: number | null, reductions: number): number | null {
  if (!rules || ageDays === null || !Number.isFinite(ageDays) || ageDays < 0) return null;
  const months = ageDays / DAYS_PER_MONTH;
  let best: number | null = null;
  for (const r of rules) {
    if (months >= r.minMonths && reductions >= r.minReductions && (best === null || r.discountPct > best)) best = r.discountPct;
  }
  return best;
}

export function rentDiscount(rules: RentRule[] | null, ageDays: number | null): number | null {
  if (!rules || ageDays === null || !Number.isFinite(ageDays) || ageDays < 0) return null;
  const weeks = ageDays / 7;
  let best: number | null = null;
  for (const r of rules) {
    if (weeks >= r.minWeeks && (best === null || r.discountPct > best)) best = r.discountPct;
  }
  return best;
}

/** Rows from the admin form: blank rows are ignored. Returns null when a filled row is not valid. */
export function rulesFromForm(get: (name: string) => string | null): { purchase: PurchaseRule[]; rentToRent: RentRule[] } | null {
  const purchase: Record<string, string>[] = [];
  const rent: Record<string, string>[] = [];
  const val = (name: string) => (get(name) ?? '').trim();
  for (let i = 0; i < RULE_LIMITS.maxRows; i += 1) {
    const p = { minMonths: val(`p_months_${i}`), minReductions: val(`p_reductions_${i}`), discountPct: val(`p_pct_${i}`) };
    if (p.minMonths !== '' || p.minReductions !== '' || p.discountPct !== '') purchase.push({ ...p, minReductions: p.minReductions || '0' });
    const r = { minWeeks: val(`r_weeks_${i}`), discountPct: val(`r_pct_${i}`) };
    if (r.minWeeks !== '' || r.discountPct !== '') rent.push(r);
  }
  const p = purchase.length === 0 ? [] : parsePurchase(purchase);
  const r = rent.length === 0 ? [] : parseRent(rent);
  if (p === null || r === null) return null;
  return { purchase: p, rentToRent: r };
}
