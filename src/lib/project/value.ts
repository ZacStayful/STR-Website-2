/**
 * Value after works and what counts as a Project deal (Part E; rule B,
 * decided 29 Sep).
 *
 *   value after works = the LOWER of
 *     (a) price + 2 × visible works needed + 1 × everything counted at cost
 *         (hidden fixes, and any line the photos can't settle), and
 *     (b) the ceiling: what similar homes nearby have sold for.
 *   value added = value after works − (price + works at the HIGH end)
 *   a Project deal adds at least £15,000 AND at least 10% of the value.
 *
 * Stamp duty, buying costs and holding are not part of the test; they are
 * in the cash needed, the money left in and the profit (finance.ts).
 * Wording everywhere: "value after works (estimate)", never "valuation" or
 * "worth"; "value added", never "uplift" on screen (Q17: "uplift" already
 * means the short-let gain over a long let).
 *
 * THE CEILING: same property type and bedrooms, sold in the last 24 months,
 * from 0.5 miles out, widening to 3 miles until there are about 10 sales (at
 * least 5). Nearer sales weigh more (1 / 0.75 / 0.5 / 0.25 by band), and the
 * ceiling is the weighted 75th percentile: the price three quarters of the
 * way up once each sale is counted by its weight. Bedrooms are recorded on
 * only about 30% of sales, so with fewer than 5 of the same bedrooms the
 * same type at any size is used (Q7). Fewer than 5 of those within 3 miles:
 * no ceiling, and the listing is not a Project deal (the value can't be
 * backed).
 *
 * Pure: no network, no database, no server-only.
 */

import { DEFAULT_PROJECT_CEILING, DEFAULT_PROJECT_VALUE, type ProjectCeilingSettings, type ProjectValueSettings } from './config.ts';
import type { WorksSummary } from './costing.ts';

/** The property types a sale and a listing are compared on. */
export type HomeType = 'flat' | 'terraced' | 'semi' | 'detached' | 'bungalow';

/** A home type from anything a portal or PropertyData writes ("End of Terrace", "semi-detached_house", "Maisonette"…). */
export function homeTypeOf(raw: string | null | undefined): HomeType | null {
  const s = (raw ?? '').toLowerCase();
  if (!s.trim()) return null;
  if (/bungalow/.test(s)) return 'bungalow';
  if (/semi/.test(s)) return 'semi';
  if (/detached/.test(s)) return 'detached';
  if (/terrace|town ?house|mews|cottage/.test(s)) return 'terraced';
  if (/flat|apartment|maisonette|studio|penthouse/.test(s)) return 'flat';
  return null;
}

export interface SoldSale {
  price: number;
  /** ISO date of the sale. */
  soldOn: string;
  distanceMiles: number;
  homeType: HomeType | null;
  bedrooms: number | null;
}

export interface Ceiling {
  value: number;
  /** Sales it rests on, and how far out they reach. */
  sales: number;
  radiusMiles: number;
  /** Same bedrooms, or (fewer than the minimum of those) the same type at any size. */
  basis: 'bedrooms' | 'type';
}

/**
 * The weighted quantile: sales by price, each counted by its weight; the
 * first price at which the running weight reaches `q` of the total.
 */
export function weightedQuantile(items: readonly { price: number; weight: number }[], q: number): number | null {
  const list = items.filter((i) => Number.isFinite(i.price) && i.price > 0 && i.weight > 0).sort((a, b) => a.price - b.price);
  if (list.length === 0) return null;
  const total = list.reduce((s, i) => s + i.weight, 0);
  const target = Math.min(1, Math.max(0, q)) * total;
  let run = 0;
  for (const i of list) {
    run += i.weight;
    if (run >= target - 1e-9) return i.price;
  }
  return list[list.length - 1].price;
}

function weightFor(miles: number, s: ProjectCeilingSettings): number {
  for (let i = 0; i < s.radiiMiles.length; i++) if (miles <= s.radiiMiles[i] + 1e-9) return s.weights[i];
  return 0;
}

function recentSince(now: Date, months: number): number {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.getTime();
}

/** Widen the circle until it holds the target; the last step otherwise. */
function widen(pool: readonly SoldSale[], s: ProjectCeilingSettings): { chosen: SoldSale[]; radius: number } {
  for (const r of s.radiiMiles) {
    const within = pool.filter((x) => x.distanceMiles <= r + 1e-9);
    if (within.length >= s.targetSales) return { chosen: within, radius: r };
  }
  const max = s.radiiMiles[s.radiiMiles.length - 1];
  return { chosen: pool.filter((x) => x.distanceMiles <= max + 1e-9), radius: max };
}

export function ceilingFrom(sales: readonly SoldSale[], subject: { homeType: HomeType | null; bedrooms: number | null }, now: Date, s: ProjectCeilingSettings = DEFAULT_PROJECT_CEILING): Ceiling | null {
  if (!subject.homeType) return null;
  const since = recentSince(now, s.months);
  const max = s.radiiMiles[s.radiiMiles.length - 1];
  const usable = sales.filter((x) => {
    const t = Date.parse(x.soldOn);
    return Number.isFinite(x.price) && x.price > 0 && Number.isFinite(x.distanceMiles) && x.distanceMiles >= 0 && x.distanceMiles <= max + 1e-9 && Number.isFinite(t) && t >= since && t <= now.getTime() && x.homeType === subject.homeType;
  });
  const attempts: { basis: Ceiling['basis']; pool: SoldSale[] }[] = [];
  if (subject.bedrooms !== null) attempts.push({ basis: 'bedrooms', pool: usable.filter((x) => x.bedrooms === subject.bedrooms) });
  attempts.push({ basis: 'type', pool: usable });
  for (const a of attempts) {
    const { chosen, radius } = widen(a.pool, s);
    if (chosen.length < s.minSales) continue;
    const value = weightedQuantile(
      chosen.map((x) => ({ price: x.price, weight: weightFor(x.distanceMiles, s) })),
      s.quantile,
    );
    if (value === null) continue;
    return { value: Math.round(value), sales: chosen.length, radiusMiles: radius, basis: a.basis };
  }
  return null;
}

export interface ValueAfterWorks {
  /** (a): price + 2 × visible works + 1 × the rest, at the high end of the works. */
  fromWorks: number;
  ceiling: Ceiling | null;
  /** The lower of the two; (a) alone when there is no ceiling to hand (the free best case). */
  value: number;
  /** True when the ceiling was the lower. */
  ceilingApplied: boolean;
}

export function valueAfterWorks(price: number, works: Pick<WorksSummary, 'visibleNeeded' | 'atCostHigh'>, ceiling: Ceiling | null, v: ProjectValueSettings = DEFAULT_PROJECT_VALUE): ValueAfterWorks {
  const fromWorks = Math.round(price + v.visibleMultiplier * works.visibleNeeded + v.hiddenMultiplier * works.atCostHigh);
  const ceilingApplied = ceiling !== null && ceiling.value < fromWorks;
  return { fromWorks, ceiling, value: ceilingApplied ? ceiling!.value : fromWorks, ceilingApplied };
}

export interface ValueTest {
  value: number;
  /** Value after works − (price + works at the high end). */
  valueAdded: number;
  /** Value added as a share of the value after works, %, one decimal. */
  valueAddedPct: number;
  passes: boolean;
  /** Which bar it missed; null when it passes. */
  missed: 'amount' | 'share' | null;
}

export function valueTest(price: number, worksHigh: number, value: number, v: ProjectValueSettings = DEFAULT_PROJECT_VALUE): ValueTest {
  const valueAdded = Math.round(value - (price + worksHigh));
  const valueAddedPct = value > 0 ? Math.round((valueAdded / value) * 1000) / 10 : 0;
  const bigEnough = valueAdded >= v.minUplift;
  const shareEnough = value > 0 && valueAdded >= (value * v.minUpliftPctOfValue) / 100;
  return { value, valueAdded, valueAddedPct, passes: bigEnough && shareEnough, missed: !bigEnough ? 'amount' : !shareEnough ? 'share' : null };
}
