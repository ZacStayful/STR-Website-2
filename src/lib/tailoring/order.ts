/**
 * Part B: the order a tailored profile's deals come in, and "fit for you".
 *
 * The order, one rule after another:
 *   1. deals that clear the short-let check on the card first
 *   2. the income band (every live deal is "qualified" today, so a no-op)
 *   3. fewest nice-to-haves missed
 *   4. most checks met
 *   5. fit for you: the shared fit (blendFit: 60% area fit, 40% the deal's
 *      own figures, unchanged) plus the named adjustments below
 *   6. profit
 *   7. the deal's id, so the order never depends on how rows arrive
 *
 * The adjustments, each worth at most ±10 and together at most ±30. None
 * re-weighs what the area fit already weighs (licensing, the distance from
 * home, managing it yourself or not), so nothing counts twice.
 *   cashflow    buyers after monthly cash flow: cash-on-cash and cash flow at
 *               their own finance
 *   growth      buyers after growth: the area's 5-year price growth (thin
 *               data) and a price below the area's typical value for the size
 *   steady      cautious members and beginners: the steadier income estimate
 *               and a low break-even up, renovation or auction wording down
 *   bold        "go for it": a motivated seller up; renovation not held against it
 *   operations  near where they already run units (a management company's
 *               operating areas count 1.5 times)
 *   sourcer     deal sourcers: a motivated seller up, and room below the
 *               area's typical value that covers their fee
 *   similar     like what they kept, opened or analysed in the last 60 days
 *
 * Pure: no network, no database, no server-only.
 */
import { bandRank, type Screening } from '../listing/screen.ts';
import { areaCentroid } from '../market/area-centroids.ts';
import { haversineMiles } from '../market/geo.ts';
import type { AreaCardData } from '../market/explorer.ts';
import { TAILORING } from './config.ts';
import type { DealFacts, Judgement, MemberFigures } from './criteria.ts';
import { asked, type Signal, type TailoringProfile } from './profile.ts';

export type AdjustmentKey = 'cashflow' | 'growth' | 'steady' | 'bold' | 'operations' | 'sourcer' | 'similar';

export interface Adjustment {
  key: AdjustmentKey;
  /** Already capped at ±adjustmentCap. */
  points: number;
  /** A short, plain reason for the why-line: "about 8 miles from your units". */
  reason: string;
}

/** What the market snapshot knows about a deal's area for its size. */
export interface AreaFacts {
  growth5y: number | null;
  /** The area's typical value for this many bedrooms. */
  typicalValue: number | null;
  /** The area's competition band ("Opportunity"), and how often its short lets are booked (%). */
  competition?: string | null;
  occupancy?: number | null;
}

export type AreaLookup = (code: string | null, bedrooms: number | null) => AreaFacts;

const NO_AREA: AreaFacts = { growth5y: null, typicalValue: null };

/** Area facts from the market snapshot's cards; nothing known on a cold cache. */
export function areaLookup(cards: readonly AreaCardData[] | null): AreaLookup {
  const byCode = new Map((cards ?? []).map((c) => [c.code, c]));
  return (code, bedrooms) => {
    const card = code ? byCode.get(code) : undefined;
    if (!card) return NO_AREA;
    const groups = card.byBedrooms ?? [];
    const group = bedrooms === null ? null : groups.find((b) => b.bedrooms === bedrooms) ?? (bedrooms >= 4 ? [...groups].filter((b) => b.bedrooms >= 4).sort((a, b) => a.bedrooms - b.bedrooms)[0] ?? null : null);
    return { growth5y: card.keyStats?.growth5y ?? null, typicalValue: group?.propertyValueMid ?? null, competition: card.competition?.label ?? null, occupancy: card.headline?.occupancy ?? null };
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const cap = (n: number) => Math.round(clamp(n, -TAILORING.adjustmentCap, TAILORING.adjustmentCap) * 10) / 10;
const gbpK = (n: number) => `£${Math.round(n / 1_000).toLocaleString('en-GB')}k`;

/** What a profile's answers make of the adjustments, read once per profile. */
export interface Leanings {
  mainGoal: 'cashflow' | 'growth' | 'both' | null;
  steady: boolean;
  bold: boolean;
  /** Postcode areas they already run units in. */
  operations: string[];
  manager: boolean;
  sourcer: boolean;
  /** The room below typical value that covers their fee, £. */
  feeRoom: number | null;
  signals: Signal[];
}

export function leaningsFor(p: TailoringProfile): Leanings {
  const g = p.goals;
  const a = p.about;
  const unitAreas = a.unitsNow !== null && a.unitsNow !== '0' ? a.unitAreas : [];
  const operatingAreas = g && asked(p, 'operating_areas') ? g.manager.operatingAreas : [];
  return {
    mainGoal: g && asked(p, 'main_goal') ? g.buyer.mainGoal : null,
    steady: a.risk === 'avoid' || a.dealsDone === '0',
    bold: a.risk === 'go',
    operations: [...new Set([...unitAreas, ...operatingAreas])],
    manager: g?.path === 'manage',
    sourcer: g?.path === 'source',
    feeRoom: g && asked(p, 'sourcing_fee') && g.sourcer.sourcingFee ? TAILORING.sourcingFeeRoom[g.sourcer.sourcingFee] : null,
    signals: p.signals,
  };
}

function cashflowPoints(fig: MemberFigures): number {
  const c = TAILORING.cashflowGoal;
  const coc = fig.cashOnCashPct === null ? 0 : clamp(fig.cashOnCashPct * c.pointsPerCashOnCashPct, 0, c.eachCap);
  const flow = fig.range === null ? 0 : clamp((fig.range.midPcm / 100) * c.pointsPerHundredPcm, 0, c.eachCap);
  return coc + flow;
}

function growthPoints(f: DealFacts, area: AreaFacts): { points: number; below: number | null } {
  const c = TAILORING.growthGoal;
  const rise = area.growth5y === null ? 0 : clamp(area.growth5y * c.pointsPerGrowthPct, 0, c.eachCap);
  const below = area.typicalValue !== null && area.typicalValue > 0 && f.amount !== null ? ((area.typicalValue - f.amount) / area.typicalValue) * 100 : null;
  const cheap = below === null ? 0 : clamp(below * c.pointsPerBelowTypicalPct, 0, c.eachCap);
  return { points: rise + cheap, below };
}

/** Miles from the deal's area to the nearest area they already run units in. */
export function operationsMiles(area: string | null, operations: readonly string[]): number | null {
  const at = area ? areaCentroid(area) : null;
  if (!at || operations.length === 0) return null;
  let best: number | null = null;
  for (const code of operations) {
    const c = areaCentroid(code);
    if (!c) continue;
    const miles = code === area ? 0 : haversineMiles(at, c);
    if (best === null || miles < best) best = miles;
  }
  return best;
}

/** Shared attributes with the signal most like this deal. */
export function likeness(f: DealFacts, signals: readonly Signal[]): number {
  let best = 0;
  const band = TAILORING.similarity.priceBandPct / 100;
  for (const s of signals) {
    let n = 0;
    if (s.kind === f.kind) n += 1;
    if (s.propertyKind !== 'unknown' && s.propertyKind === f.propertyKind) n += 1;
    if (s.bedrooms !== null && s.bedrooms === f.bedrooms) n += 1;
    if (s.area !== null && s.area === f.area) n += 1;
    if (s.amount !== null && f.amount !== null && s.kind === f.kind && Math.abs(f.amount - s.amount) <= s.amount * band) n += 1;
    if (n > best) best = n;
  }
  return best;
}

/** Every adjustment that applies to this deal for this profile, each capped. */
export function adjustmentsFor(f: DealFacts, fig: MemberFigures, l: Leanings, area: AreaFacts): Adjustment[] {
  const out: Adjustment[] = [];
  const add = (key: AdjustmentKey, points: number, reason: string) => {
    const p = cap(points);
    if (p !== 0) out.push({ key, points: p, reason });
  };

  if (f.kind === 'sale' && l.mainGoal) {
    const flow = cashflowPoints(fig);
    const growth = growthPoints(f, area);
    const growthWhy = growth.below !== null && growth.below > 0 ? 'below the area’s typical price for its size' : 'prices in the area are rising';
    if (l.mainGoal === 'cashflow') add('cashflow', flow, 'strong cash flow at your figures');
    else if (l.mainGoal === 'growth') add('growth', growth.points, growthWhy);
    else {
      add('cashflow', flow / 2, 'strong cash flow at your figures');
      add('growth', growth.points / 2, growthWhy);
    }
  }

  if (l.steady) {
    const s = TAILORING.steady;
    let points = 0;
    if (f.confidence === 'high' || f.confidence === 'medium') points += s.confidencePoints;
    if (f.kind === 'rent' && fig.breakEvenPct !== null) points += fig.breakEvenPct <= s.breakEvenLowPct ? s.breakEvenLowPoints : fig.breakEvenPct <= s.breakEvenMidPct ? s.breakEvenMidPoints : 0;
    // "Go for it" as well (a bold beginner): renovation is what they signed up for.
    const penalised = f.needsWork && !l.bold;
    if (penalised) points += s.workPoints;
    add('steady', points, penalised ? 'a project: it needs work' : 'steadier figures');
  }

  if (l.bold) add('bold', (f.motivationScore / 10) * TAILORING.bold.motivationPointsPer10, 'a seller who looks ready to deal');

  const miles = operationsMiles(f.area, l.operations);
  if (miles !== null) {
    const o = TAILORING.operations;
    const share = miles <= o.fullMiles ? 1 : miles >= o.zeroMiles ? 0 : 1 - (miles - o.fullMiles) / (o.zeroMiles - o.fullMiles);
    add('operations', share * o.points * (l.manager ? o.managerMultiplier : 1), miles < 1 ? 'in an area you already run units in' : `about ${Math.round(miles)} miles from your units`);
  }

  if (l.sourcer) {
    const room = area.typicalValue !== null && f.amount !== null && f.kind === 'sale' ? area.typicalValue - f.amount : null;
    const roomPoints = room !== null && l.feeRoom !== null && room >= l.feeRoom ? TAILORING.sourcer.roomPoints : 0;
    const motivated = (f.motivationScore / 10) * TAILORING.sourcer.motivationPointsPer10;
    const beds = f.bedrooms !== null ? `${f.bedrooms}-bed` : 'home';
    add('sourcer', motivated + roomPoints, roomPoints > 0 && room !== null ? `${gbpK(room)} under the area’s typical ${beds}` : 'a seller who looks ready to deal');
  }

  const alike = likeness(f, l.signals);
  if (alike > 0) add('similar', Math.min(TAILORING.similarity.cap, alike * TAILORING.similarity.perAttribute), 'like deals you’ve kept');

  return out;
}

/** All the adjustments together, capped at ±adjustmentTotalCap. */
export function bonusOf(adjs: readonly Adjustment[]): number {
  const total = adjs.reduce((s, a) => s + a.points, 0);
  return Math.round(clamp(total, -TAILORING.adjustmentTotalCap, TAILORING.adjustmentTotalCap) * 10) / 10;
}

/** What the order compares, for Today's candidates and the daily pick's alike. */
export interface OrderKey {
  precheckOk: boolean;
  band: number;
  niceMissed: number;
  met: number;
  /** The shared fit plus the adjustments. */
  fit: number;
  profit: number | null;
  id: string;
}

export function compareKeys(a: OrderKey, b: OrderKey): number {
  return (
    Number(!a.precheckOk) - Number(!b.precheckOk) ||
    a.band - b.band ||
    a.niceMissed - b.niceMissed ||
    b.met - a.met ||
    b.fit - a.fit ||
    (b.profit ?? -Infinity) - (a.profit ?? -Infinity) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function orderKey(c: { precheck: string; screening?: Screening | null; fit: number }, j: Judgement | undefined, bonus: number, profit: number | null, id: string): OrderKey {
  return { precheckOk: c.precheck === 'ok', band: bandRank(c.screening?.band ?? 'qualified'), niceMissed: j?.niceMissed ?? 0, met: j?.met ?? 0, fit: c.fit + bonus, profit, id };
}
