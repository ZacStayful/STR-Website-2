/**
 * "The typical deal in their budget" (Batch 28, Part C): the median and the
 * 40th percentile of screened BTL deals in the member's cash band, starting
 * where the member searched and widening outward only when there aren't
 * enough: 10, 25, 50 miles, then the region (or the 50-mile circle if that
 * holds more), then the whole country, until the step holds 30 deals.
 *
 * Every BTL-screened listing in the band counts, not only the ones that pass
 * (Q7): the benchmark is the typical deal on the market. Below 30 even
 * nationally the country is used and called thin ("based on 26 deals");
 * below 10 there is nothing to compare with and the hard rules alone decide
 * (Q6). Computed in the nightly run and stored, never per page view.
 *
 * Pure: no network, no database, no server-only.
 */

import { haversineMiles } from '../market/geo.ts';
import { DEFAULT_BTL_BENCHMARK, type BtlBenchmarkSettings } from './config.ts';
import type { CashBand } from './deal.ts';
import { percentile } from './rent.ts';

/** One screened listing, as the benchmark reads it. */
export interface BenchmarkDeal {
  band: CashBand;
  lat: number | null;
  lng: number | null;
  region: string | null;
  /** The middle ROI, %. */
  roiMidPct: number;
  /** The middle annual growth, %; null when the district has no growth figure. */
  growthMidPct: number | null;
}

export type BenchmarkStepKey = `${number}mi` | 'region' | 'national';

export interface BenchmarkStep {
  key: BenchmarkStepKey;
  radiusMiles: number | null;
  count: number;
}

export interface Benchmark {
  band: CashBand;
  /** The step used. */
  step: BenchmarkStepKey;
  radiusMiles: number | null;
  count: number;
  /** Every step tried, in order, with its count. */
  steps: BenchmarkStep[];
  roiMedianPct: number;
  roiP40Pct: number;
  /** Null when no deal in the step has a growth figure. */
  growthMedianPct: number | null;
  growthP40Pct: number | null;
  /** Fewer than the minimum even nationally. */
  thin: boolean;
  /** Fewer than the floor: nothing to compare with. */
  none: boolean;
}

export interface BenchmarkCentre {
  lat: number;
  lng: number;
  region: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function stats(deals: readonly BenchmarkDeal[], pct: number): Pick<Benchmark, 'roiMedianPct' | 'roiP40Pct' | 'growthMedianPct' | 'growthP40Pct'> {
  const roi = deals.map((d) => d.roiMidPct).filter(Number.isFinite).sort((a, b) => a - b);
  const growth = deals.map((d) => d.growthMidPct).filter((g): g is number => g !== null && Number.isFinite(g)).sort((a, b) => a - b);
  return {
    roiMedianPct: roi.length > 0 ? round2(percentile(roi, 0.5)) : 0,
    roiP40Pct: roi.length > 0 ? round2(percentile(roi, pct / 100)) : 0,
    growthMedianPct: growth.length > 0 ? round2(percentile(growth, 0.5)) : null,
    growthP40Pct: growth.length > 0 ? round2(percentile(growth, pct / 100)) : null,
  };
}

/** The benchmark for a member's band, from their nearest area outward. */
export function benchmarkFor(deals: readonly BenchmarkDeal[], centre: BenchmarkCentre | null, band: CashBand, s: BtlBenchmarkSettings = DEFAULT_BTL_BENCHMARK): Benchmark {
  const inBand = deals.filter((d) => d.band === band);
  const steps: BenchmarkStep[] = [];
  const located = centre ? inBand.filter((d) => d.lat !== null && d.lng !== null).map((d) => ({ d, miles: haversineMiles(centre, { lat: d.lat as number, lng: d.lng as number }) })) : [];
  let chosen: { key: BenchmarkStepKey; radiusMiles: number | null; set: BenchmarkDeal[] } | null = null;
  let widest: BenchmarkDeal[] = [];
  if (centre) {
    for (const miles of s.stepsMiles) {
      const set = located.filter((x) => x.miles <= miles).map((x) => x.d);
      widest = set;
      steps.push({ key: `${miles}mi`, radiusMiles: miles, count: set.length });
      if (set.length >= s.minDeals) {
        chosen = { key: `${miles}mi`, radiusMiles: miles, set };
        break;
      }
    }
    if (!chosen && s.region && centre.region) {
      // The region, or the widest circle when that holds more: a step never shrinks.
      const region = inBand.filter((d) => d.region === centre.region);
      const set = region.length >= widest.length ? region : widest;
      steps.push({ key: 'region', radiusMiles: null, count: set.length });
      if (set.length >= s.minDeals) chosen = { key: 'region', radiusMiles: null, set };
    }
  }
  if (!chosen) {
    steps.push({ key: 'national', radiusMiles: null, count: inBand.length });
    chosen = { key: 'national', radiusMiles: null, set: inBand };
  }
  const count = chosen.set.length;
  return {
    band,
    step: chosen.key,
    radiusMiles: chosen.radiusMiles,
    count,
    steps,
    ...stats(chosen.set, s.balancedPercentile),
    thin: count < s.minDeals,
    none: count < s.floorDeals,
  };
}

/** "within 25 miles", "across the North West", "across the UK": how the deal page names the benchmark used. */
export function benchmarkWhere(b: Pick<Benchmark, 'step' | 'radiusMiles'>, regionName: string | null): string {
  if (b.radiusMiles !== null) return `within ${b.radiusMiles} miles`;
  if (b.step === 'region') return regionName ? `across ${regionName}` : 'across the region';
  return 'across the UK';
}

const finite = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const isStepKey = (v: unknown): v is BenchmarkStepKey => v === 'region' || v === 'national' || (typeof v === 'string' && /^\d+mi$/.test(v));

/** A stored btl_benchmarks row back into a Benchmark (the nightly run writes it); null when it is not one. */
export function benchmarkFromRow(row: unknown): Benchmark | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const band = r.band;
  if (band !== 'under_25k' && band !== '25k_50k' && band !== '50k_100k' && band !== '100k_plus') return null;
  if (!isStepKey(r.step)) return null;
  const count = finite(r.deal_count);
  const roiMedian = finite(r.roi_median);
  const roiP40 = finite(r.roi_p40);
  if (count === null || roiMedian === null || roiP40 === null) return null;
  const steps: BenchmarkStep[] = Array.isArray(r.steps)
    ? (r.steps as unknown[]).flatMap((x) => {
        const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
        const n = o ? finite(o.count) : null;
        return o && isStepKey(o.key) && n !== null ? [{ key: o.key, radiusMiles: finite(o.radiusMiles), count: n }] : [];
      })
    : [];
  return {
    band,
    step: r.step,
    radiusMiles: finite(r.radius_miles),
    count,
    steps,
    roiMedianPct: roiMedian,
    roiP40Pct: roiP40,
    growthMedianPct: finite(r.growth_median),
    growthP40Pct: finite(r.growth_p40),
    thin: r.thin === true,
    none: r.no_compare === true,
  };
}
