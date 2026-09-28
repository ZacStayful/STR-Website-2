import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chooseTodayFrom, type ChooseInput, type ChooseReads, type TodayChoice } from './choose.ts';
import { chooseDay } from './choose-day.ts';
import { plainProfile, usesTailoring } from '../tailoring/profile.ts';
import { applyKindFeedback, buildCandidate, CLOSEST_ADVICE, dealKey, filtersForGoals, nearestAreas, nearestOutside, orderForToday, referencePoint, WIDEN_AREA_ADVICE, type Built, type CandidateContext, type PoolRow, type TodayCandidate } from './candidates.ts';
import { TODAY_SIZE } from './day.ts';
import { applyCandidateFeedback, feedbackRules, PICK_REASONS, type AppliedRules, type PickFeedback, type PickReason } from '../listing/picks.ts';
import { rankForMember } from '../listing/rank.ts';
import { rankPicks, type SourcedListing } from '../listing/sourcing.ts';
import { isSendable, type Band } from '../listing/screen.ts';
import { analyseRelaxation, closestMatch, describeRelaxation } from '../listing/relax.ts';
import { personaliseScore, personalInputFor } from '../market/personalise.ts';
import { areaMetaForCode } from '../market/areas.ts';
import { parseMarketGoals, type MarketGoals } from '../market/goals.ts';
import type { AreaCardData } from '../market/explorer.ts';
import type { DealFilters } from '../marketplace/grid.ts';

// ─── The code as it stood in selection.ts before the extraction ─────────
// Copied verbatim from chooseToday and its helpers, with only the reads
// turned into parameters (the pool, the full listings) and the market
// snapshot passed in rather than awaited. It is the reference, not an
// implementation: do not "tidy" it.

async function legacyChooseToday(input: ChooseInput, reads: ChooseReads): Promise<TodayChoice> {
  const { goals, feedback, exclude, now } = input;
  const rules = feedbackRules(feedback);
  const filters = applyKindFeedback(filtersForGoals(goals, input.savedAreas), rules);
  const mode = goals?.motivation.mode ?? 'off';
  const ctx = legacyCandidateContext(goals, filters, input.cards, now);
  const usable = (rows: PoolRow[]): Built[] => {
    const out: Built[] = [];
    for (const row of rows) {
      if (exclude.has(row.id)) continue;
      if (row.postcode_area && rules.badAreas.has(row.postcode_area.toUpperCase())) continue;
      const built = buildCandidate(row, ctx);
      if (built) out.push(built);
    }
    return out;
  };

  const pool = usable(await reads.pool(filters, 1000));
  const exact = pool.filter((b) => b.fails.length === 0).map((b) => b.candidate);
  const ranked = rankForMember(exact, feedback, rules, { depth: 40, mode }).ranked;
  const top = await legacyWithFullListings(reads, orderForToday(ranked), feedback, rules);
  if (top.length > 0) return { dealIds: top.slice(0, TODAY_SIZE).map((c) => c.dealId), nearMiss: false, advice: null };

  const loose = usable(await reads.pool({ ...filters, minPrice: null, maxPrice: null }, 400));
  const misses = legacyViableMisses(loose.filter((b) => b.fails.length > 0), feedback, rules);
  let closest: Built | null = null;
  if (misses.length > 0) {
    const best = closestMatch(
      misses.map((m) => m.near),
      (l) => misses.find((m) => m.near.listing === l)?.candidate.motivation?.score ?? 0,
    );
    const chosen = best ? misses.find((m) => m.near === best) ?? null : null;
    closest = chosen;
    const motiv = goals?.motivation ?? null;
    const kind = chosen?.candidate.listing.kind ?? 'sale';
    const relaxation = analyseRelaxation(
      misses.map((m) => m.near),
      { kind, thresholdUnits: motiv ? (kind === 'rent' ? motiv.minWeeksOnMarket : motiv.minMonthsOnMarket) : 0, maxPrice: filters.maxPrice, minBedrooms: null },
    );
    const advice = describeRelaxation(relaxation);
    if (chosen && advice) return { dealIds: [chosen.candidate.dealId], nearMiss: true, advice };
  }
  if (filters.areas.length > 0) {
    const own = new Set(filters.areas);
    const from = referencePoint(goals, filters.areas);
    const nearby = nearestAreas(from, own, 12);
    if (nearby.length > 0) {
      const wide = usable(await reads.pool({ ...filters, areas: nearby }, 400));
      const around = rankForMember(wide.filter((b) => b.fails.length === 0).map((b) => b.candidate), feedback, rules, { depth: 400, mode }).ranked;
      const checked = await legacyWithFullListings(reads, around, feedback, rules, around.length);
      const nearest = nearestOutside(checked, from, own);
      if (nearest) return { dealIds: [nearest.dealId], nearMiss: true, advice: WIDEN_AREA_ADVICE };
    }
  }
  if (closest) return { dealIds: [closest.candidate.dealId], nearMiss: true, advice: CLOSEST_ADVICE };
  return { dealIds: [], nearMiss: false, advice: null };
}

function legacyViableMisses(misses: Built[], feedback: PickFeedback[], rules: AppliedRules): Built[] {
  const survivors = new Set(applyCandidateFeedback(misses.map((m) => m.candidate), feedback, rules).map((c) => c.dealId));
  const pass = misses.filter((m) => survivors.has(m.candidate.dealId));
  const works = new Set(rankPicks(pass.map((m) => m.candidate), pass.length, 'off').map((c) => c.dealId));
  return pass.filter((m) => works.has(m.candidate.dealId) && (!m.candidate.screening || isSendable(m.candidate.screening)) && (m.candidate.precheck === 'ok' || !rules.strictSuitability));
}

function legacyCandidateContext(goals: MarketGoals | null, filters: DealFilters, cardsIn: readonly AreaCardData[] | null, now: Date): CandidateContext {
  const cards = cardsIn ?? [];
  const byCode = new Map(cards.map((c) => [c.code, c]));
  const fits = new Map<string, number | null>();
  return {
    goals,
    areaFit: (code) => {
      if (!code) return null;
      if (fits.has(code)) return fits.get(code)!;
      const card = byCode.get(code);
      const fit = !card ? null : goals ? personaliseScore(personalInputFor(card, goals), goals)?.score ?? card.score?.score ?? null : card.score?.score ?? null;
      fits.set(code, fit);
      return fit;
    },
    areaName: (code) => (code ? byCode.get(code)?.name ?? areaMetaForCode(code).name : 'the UK'),
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    now,
  };
}

async function legacyWithFullListings<C extends TodayCandidate>(reads: ChooseReads, ranked: C[], feedback: PickFeedback[], rules: AppliedRules, limit = 40): Promise<C[]> {
  const head = ranked.slice(0, limit);
  if (head.length === 0) return [];
  const snapshots = await reads.fullListings(head.map((c) => c.dealId));
  const full = head.map((c) => {
    const snap = snapshots.get(c.dealId);
    return snap ? { ...c, listing: { ...snap, canonicalUrl: dealKey(c.dealId) } } : c;
  });
  const kept = new Set(applyCandidateFeedback(full, feedback, rules).map((c) => c.dealId));
  return head.filter((c) => kept.has(c.dealId));
}

// ─── Scenarios ─────────────────────────────────────────────────────────

const NOW = new Date('2026-09-28T09:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

/** Deterministic, so a failure names a seed that reproduces it. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const chance = (p: number) => next() < p;
  const some = <T>(xs: readonly T[], p: number): T[] => xs.filter(() => chance(p));
  return { int, pick, chance, some };
}
type Rng = ReturnType<typeof rng>;

// East Midlands and Yorkshire, where the members and most of the deals are,
// plus areas far enough away that "nearest outside" has somewhere to reach.
const AREAS = ['NG', 'DE', 'LE', 'S', 'LN', 'DN', 'LS', 'YO', 'M', 'B'];
const HOMES = [
  { postcode: 'NG1 1AA', lat: 52.9536, lng: -1.1505 },
  { postcode: 'LS1 4AP', lat: 53.7997, lng: -1.5492 },
  { postcode: 'YO1 7HH', lat: 53.9591, lng: -1.0815 },
  { postcode: 'M1 1AE', lat: 53.4808, lng: -2.2426 },
  { postcode: 'DE1 1AA', lat: null, lng: null },
];
const TYPES = [null, 'Flat', 'Apartment', 'Terraced house', 'Semi-detached house', 'Detached house', 'Bungalow', 'Maisonette'];
const TITLES = ['3 bed terraced house for sale', 'Spacious family home', 'Needs modernisation throughout', 'Flat for sale', 'For sale by auction', 'Renovation project', 'Ideal investment'];
const BANDS: Band[] = ['qualified', 'qualified', 'qualified', 'medium', 'unqualified', 'insufficient-data'];
const SIGNALS = ['long_on_market', 'price_reduced', 'reduced_repeatedly', 'back_on_market', 'slower_than_area'];
const REASONS = [...PICK_REASONS.map((x) => x.key), 'wrong_size', 'wrong_type'] as PickReason[];

/**
 * A member's goals as they are really stored: nothing, the welcome
 * questions, or the fuller profiles the two members with goals have
 * (motivated only / prefer, a home and a radius, both kinds, their own
 * finance and priorities). Written raw and parsed, as the loader reads them.
 */
function goalsFor(r: Rng): MarketGoals | null {
  const shape = r.int(0, 9);
  if (shape <= 2) return null;
  const kind = r.pick(['sale', 'sale', 'rent', 'both'] as const);
  const home = r.chance(0.55) ? r.pick(HOMES) : null;
  const raw: Record<string, unknown> = {
    version: r.pick([1, 2]),
    sourcingKind: kind,
    budget: r.pick([null, 'u200', '200-350', '350-500', '500+']),
    maxRentPcm: r.pick([null, 700, 1_000, 1_500, 2_500]),
    home,
    maxDistanceMiles: home ? r.pick([null, 10, 25, 30, 50, 100]) : null,
    where: r.pick([null, 'near', 'areas', 'anywhere', 'near_plus_best']),
    bedrooms: r.pick([null, 1, 2, 3, 4]),
  };
  if (shape >= 6) {
    raw.motivation = { mode: r.pick(['off', 'prefer', 'only', 'only']), minMonthsOnMarket: r.int(1, 8), minWeeksOnMarket: r.int(1, 12), areaRelative: r.chance(0.5) };
    raw.priorities = { yield: r.int(0, 3), revenue: r.int(0, 3), lowCompetition: r.int(0, 3), directBookings: r.int(0, 3) };
    raw.management = r.pick(['self', 'managed']);
    raw.riskAppetite = r.pick(['cautious', 'balanced', 'tolerant']);
    raw.finance = { depositPct: r.pick([15, 25, 40]), mortgageRatePct: r.pick([4.5, 5.5, 7]), termYears: 25, targetYieldPct: r.pick([8, 10, 12]), targetMarginPcm: r.pick([300, 500, 900]) };
  }
  const goals = parseMarketGoals(raw);
  assert.ok(goals, 'the generator writes goals the parser accepts');
  return goals;
}

function rowFor(r: Rng, i: number): PoolRow {
  const kind = r.chance(0.65) ? 'sale' : 'rent';
  const price = kind === 'sale' ? r.int(50, 650) * 1_000 : r.int(400, 3_200);
  const profit = r.chance(0.05) ? null : r.int(-6_000, 40_000);
  const dealShape = r.int(0, 19);
  const deal =
    dealShape === 0
      ? null
      : dealShape === 1
        ? { kind: 'purchase', grossYieldPct: 9 }
        : kind === 'sale'
          ? { kind: 'purchase', grossYieldPct: r.int(-2, 18), targetYieldPct: 10, grossRevenue: r.int(12, 60) * 1_000, cashflowMonthly: r.int(-400, 1_500) }
          : { kind: 'rent-to-rent', monthlyMargin: r.int(-300, 2_000), targetMarginPcm: 500, grossRevenue: r.int(12, 60) * 1_000 };
  const score = kind === 'sale' ? r.int(-20, 120) : r.int(-4_000, 30_000);
  const motivationScore = r.int(0, 100);
  return {
    id: `d${i}`,
    source: r.pick(['rightmove', 'onthemarket', 'zoopla'] as const),
    kind,
    postcode_area: r.chance(0.04) ? null : r.pick(AREAS),
    outcode: r.chance(0.1) ? null : `${r.pick(AREAS)}${r.int(1, 20)}`,
    town: 'Somewhere',
    bedrooms: r.chance(0.08) ? null : r.int(1, 6),
    price_amount: r.chance(0.04) ? null : price,
    price_period: kind === 'sale' ? 'total' : 'pcm',
    raw_type: r.pick(TYPES),
    tenure: r.pick([null, 'Freehold', 'Leasehold', 'Ask agent']),
    band: 'qualified',
    annual_profit: profit,
    uplift_pct: kind === 'sale' ? r.int(-20, 120) : null,
    reduced_at: r.chance(0.2) ? daysAgo(r.int(0, 30)) : null,
    listed_date: r.chance(0.3) ? null : daysAgo(r.int(0, 420)),
    status: 'live',
    first_seen_at: daysAgo(r.int(0, 300)),
    last_checked_live_at: null,
    last_confirmed_at: daysAgo(1),
    last_confirmed_via: 'live',
    live_since: daysAgo(r.int(0, 200)),
    deal,
    suitability: r.pick(['ok', 'ok', 'ok', 'unknown', null, 'fail']),
    screening: r.chance(0.12) ? null : kind === 'sale' ? { kind: 'purchase', band: r.pick(BANDS), upliftPct: score, surplus: score * 100 } : { kind: 'rent-to-rent', band: r.pick(BANDS), annualProfit: score, surplus: score },
    motivation: r.chance(0.35) ? null : { score: motivationScore, firmScore: r.int(0, motivationScore), fired: r.some(SIGNALS, 0.4) },
  };
}

/** The full stored listing, for the rows that have one: titles and features the card's columns lack. */
function snapshotFor(r: Rng, row: PoolRow): SourcedListing {
  return {
    source: row.source,
    id: row.id,
    canonicalUrl: `https://www.rightmove.co.uk/properties/${row.id}`,
    kind: row.kind,
    title: r.pick(TITLES),
    address: '1 High Street',
    postcode: `${row.postcode_area ?? 'NG'}1 1AA`,
    outcode: row.outcode,
    postcodeArea: row.postcode_area,
    lat: null,
    lng: null,
    bedrooms: row.bedrooms,
    bathrooms: null,
    price: row.price_amount === null ? null : { amount: Number(row.price_amount), period: row.kind === 'rent' ? 'pcm' : 'total' },
    rawType: r.chance(0.2) ? r.pick(TYPES) : row.raw_type,
    photo: null,
    features: r.chance(0.15) ? ['Cash buyers only'] : [],
    tenure: row.tenure,
    listedDate: row.listed_date,
  };
}

/** Answers, usually about deals like the ones on offer, so the rules bite. */
function feedbackFor(r: Rng, rows: PoolRow[]): PickFeedback[] {
  const out: PickFeedback[] = [];
  const n = r.pick([0, 0, 0, 1, 2, 3, 5]);
  for (let i = 0; i < n; i += 1) {
    const about = rows.length > 0 ? r.pick(rows) : rowFor(r, 10_000 + i);
    out.push({
      reaction: r.pick(['no', 'no', 'no', 'yes', null] as const),
      reactionSource: r.pick(['form', 'form', 'link', null] as const),
      reasons: r.some(REASONS, 0.12),
      kind: about.kind,
      postcodeArea: about.postcode_area,
      bedrooms: about.bedrooms,
      amount: about.price_amount === null ? null : Number(about.price_amount),
      rawType: about.raw_type,
      outcode: about.outcode,
      screeningScore: r.chance(0.5) ? r.int(-10, 80) : null,
    });
  }
  return out;
}

/** The market snapshot's area cards, as far as area fit reads them. */
function cardsFor(r: Rng): AreaCardData[] | null {
  if (r.chance(0.2)) return null;
  return r.some(AREAS, 0.8).map((code) => {
    const mid = r.int(100, 400) * 1_000;
    return {
      code,
      name: `${code} area`,
      score: r.chance(0.1) ? null : { score: r.int(20, 95) },
      headline: { grossRevenue: r.chance(0.1) ? null : r.int(15, 45) * 1_000, occupancy: r.int(40, 80), adr: 120, totalSamples: 40, bedroomsAvailable: [1, 2, 3, 4] },
      byBedrooms: [2, 3, 4].map((bedrooms) => ({ bedrooms, propertyValueMid: mid + bedrooms * 20_000 })),
      yieldOnCost: r.chance(0.2) ? null : { grossYieldPct: r.int(4, 14), propertyValueMid: mid },
      competition: r.chance(0.3) ? null : { intensity: r.int(0, 100) },
      directBooking: r.chance(0.3) ? null : { score: r.int(0, 100) },
      licensing: { status: r.pick(['confirmed-unrestricted', 'confirmed-licensed', 'unknown']) },
    } as unknown as AreaCardData;
  });
}

interface Scenario {
  input: ChooseInput;
  rows: PoolRow[];
  passed: Set<string>;
  snapshots: Map<string, SourcedListing>;
}

function scenarioFor(seed: number): Scenario {
  const r = rng(seed);
  const rows = Array.from({ length: r.pick([0, 3, 8, 20, 40, 60, 90]) }, (_, i) => rowFor(r, i));
  const goals = goalsFor(r);
  const savedAreas = r.chance(0.35) ? [...r.some(AREAS, 0.2), ...(r.chance(0.1) ? ['zz', 'ng'] : [])] : [];
  const feedback = feedbackFor(r, rows);
  const exclude = new Set(r.some(rows, 0.12).map((row) => row.id));
  const passed = new Set([...exclude].filter(() => r.chance(0.5)));
  const snapshots = new Map<string, SourcedListing>();
  for (const row of rows) if (r.chance(0.75)) snapshots.set(row.id, snapshotFor(r, row));
  return { input: { goals, savedAreas, feedback, exclude, cards: cardsFor(r), now: NOW }, rows, passed, snapshots };
}

/** Object keys in a fixed order, so the trace is about values, not construction order. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/**
 * The reads, as rankingPool and the full-listing lookup answer them: live
 * deals matching the filters (a null price never passes a price bound, as in
 * SQL), the member's passes left out, best profit first, then a stable key.
 * Every call is recorded.
 */
function readsFor(s: Scenario): { reads: ChooseReads; trace: string[] } {
  const trace: string[] = [];
  const reads: ChooseReads = {
    pool: async (f, limit) => {
      trace.push(`pool ${limit} ${stable(f)}`);
      const n = (v: number | null) => (v === null ? null : Number(v));
      return s.rows
        .filter((row) => {
          if (s.passed.has(row.id)) return false;
          if (f.kind !== 'both' && row.kind !== f.kind) return false;
          if (f.areas.length > 0 && !(row.postcode_area && f.areas.includes(row.postcode_area))) return false;
          if (f.beds === '4+' ? !(row.bedrooms !== null && row.bedrooms >= 4) : f.beds !== 'any' && row.bedrooms !== Number(f.beds)) return false;
          const price = n(row.price_amount);
          if (f.minPrice !== null && (price === null || price < f.minPrice)) return false;
          if (f.maxPrice !== null && (price === null || price > f.maxPrice)) return false;
          if (f.minProfit !== null && (row.annual_profit === null || row.annual_profit < f.minProfit)) return false;
          if (f.minUplift !== null && f.kind === 'sale' && (row.uplift_pct === null || row.uplift_pct < f.minUplift)) return false;
          return true;
        })
        .sort((a, b) => (b.annual_profit ?? -Infinity) - (a.annual_profit ?? -Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, limit)
        .map((row) => ({ ...row }));
    },
    fullListings: async (ids) => {
      trace.push(`full ${ids.join(',')}`);
      const out = new Map<string, SourcedListing>();
      for (const id of ids) {
        const snap = s.snapshots.get(id);
        if (snap) out.set(id, { ...snap });
      }
      return out;
    },
  };
  return { reads, trace };
}

const SEEDS = 600;
const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(here, '__fixtures__', 'choose-golden.json');

type GoldenCase = [seed: number, ids: string, nearMiss: 0 | 1, advice: string | null, reads: number, readsHash: string];

function goldenCase(seed: number, choice: TodayChoice, trace: string[]): GoldenCase {
  const hash = createHash('sha256').update(trace.join('\n')).digest('hex').slice(0, 16);
  return [seed, choice.dealIds.join(','), choice.nearMiss ? 1 : 0, choice.advice, trace.length, hash];
}

// ─── Today is unchanged for a member with no tailoring answers ─────────

test('choosing Today from injected reads gives exactly what selection.ts chose, read for read', async () => {
  const seen = { exact: 0, relaxAdvice: 0, widenArea: 0, closestOnly: 0, empty: 0, fullListingDrop: 0, strictSuitability: 0, kindFlip: 0, wrongArea: 0, coldCache: 0, motivatedOnly: 0, noGoals: 0, depthCut: 0, throughDispatch: 0 };
  const cases: GoldenCase[] = [];
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const s = scenarioFor(seed);
    const before = readsFor(s);
    const after = readsFor(s);
    const legacy = await legacyChooseToday(s.input, before.reads);
    const now = await chooseTodayFrom(s.input, after.reads);
    const where = `seed ${seed}`;
    assert.deepStrictEqual(now, legacy, `choice differs: ${where}`);
    assert.deepStrictEqual(after.trace, before.trace, `reads differ: ${where}`);
    cases.push(goldenCase(seed, legacy, before.trace));

    // Batch 14: a profile with no new answers (the welcome's and the quiz's
    // mandatory ones only) goes through the dispatcher to exactly this.
    const plain = plainProfile(s.input.goals, s.input.savedAreas, { high: 10, medium: 15, low: 25 }, { answered: { roles: { at: '2026-09-01T00:00:00Z', notSure: false }, where: { at: '2026-09-01T00:00:00Z', notSure: false }, budget: { at: '2026-09-01T00:00:00Z', notSure: false } } });
    if (!usesTailoring(plain)) {
      const third = readsFor(s);
      const viaDay = await chooseDay({ ...s.input, tailoring: plain }, third.reads);
      assert.deepStrictEqual({ dealIds: viaDay.dealIds, nearMiss: viaDay.nearMiss, advice: viaDay.advice }, legacy, `dispatch differs: ${where}`);
      assert.equal(viaDay.mustMatches, null);
      assert.deepStrictEqual(third.trace, before.trace, `dispatch reads differ: ${where}`);
      seen.throughDispatch += 1;
    }

    const rules = feedbackRules(s.input.feedback);
    const base = filtersForGoals(s.input.goals, s.input.savedAreas);
    if (!legacy.nearMiss && legacy.dealIds.length > 0) {
      seen.exact += 1;
      const firstFull = before.trace.find((t) => t.startsWith('full '))?.slice(5).split(',') ?? [];
      if (legacy.dealIds.join(',') !== firstFull.slice(0, TODAY_SIZE).join(',')) seen.fullListingDrop += 1;
      if (firstFull.length === 40) seen.depthCut += 1;
    }
    if (legacy.nearMiss && legacy.advice !== WIDEN_AREA_ADVICE && legacy.advice !== CLOSEST_ADVICE) seen.relaxAdvice += 1;
    if (legacy.advice === WIDEN_AREA_ADVICE) seen.widenArea += 1;
    if (legacy.advice === CLOSEST_ADVICE) seen.closestOnly += 1;
    if (legacy.dealIds.length === 0) seen.empty += 1;
    if (rules.strictSuitability) seen.strictSuitability += 1;
    if (rules.wantKind && rules.wantKind !== base.kind) seen.kindFlip += 1;
    if (s.rows.some((row) => row.postcode_area && rules.badAreas.has(row.postcode_area))) seen.wrongArea += 1;
    if (s.input.cards === null) seen.coldCache += 1;
    if (s.input.goals?.motivation.mode === 'only') seen.motivatedOnly += 1;
    if (!s.input.goals) seen.noGoals += 1;
  }
  // A comparison that never reached a branch proves nothing about it.
  for (const [branch, n] of Object.entries(seen)) assert.ok(n > 0, `no seed exercised: ${branch}`);

  // The golden record: what the untailored path chose, and the reads it made
  // to get there. Every later change must reproduce it for members with no
  // tailoring answers. Regenerate (UPDATE_GOLDEN=1) only for a change to that
  // path that is meant, and say so in the commit.
  if (process.env.UPDATE_GOLDEN === '1') {
    const body = cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n');
    writeFileSync(GOLDEN, `{\n  "about": "Today's list for members with no tailoring answers, recorded from the behaviour-free extraction of chooseToday (Batch 14). Each case: seed, deal ids, near miss, advice, number of reads, hash of the reads. Regenerate with UPDATE_GOLDEN=1 only for an intended change to the untailored path.",\n  "seeds": ${SEEDS},\n  "cases": [\n${body}\n  ]\n}\n`);
  }
  assert.ok(existsSync(GOLDEN), 'the golden record is missing: run once with UPDATE_GOLDEN=1 and commit it');
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { seeds: number; cases: GoldenCase[] };
  assert.equal(golden.seeds, SEEDS);
  for (let i = 0; i < cases.length; i += 1) assert.deepStrictEqual(cases[i], golden.cases[i], `differs from the golden record: seed ${cases[i][0]}`);
  assert.equal(golden.cases.length, cases.length);
});

test('the full listing is read only for the head of the ranking, and never returned', async () => {
  const s = scenarioFor(7);
  const { reads, trace } = readsFor(s);
  const choice = await chooseTodayFrom(s.input, reads);
  for (const t of trace.filter((x) => x.startsWith('full '))) assert.ok(t.slice(5).split(',').length <= 400);
  // Only ids leave: no URL, address or postcode.
  const text = JSON.stringify(choice);
  assert.ok(!/https?:|High Street|\d[A-Z]{2}\b/.test(text), text);
});

test('a member with nothing to rank gets an empty day without a second read when they have no areas', async () => {
  const input: ChooseInput = { goals: null, savedAreas: [], feedback: [], exclude: new Set(), cards: null, now: NOW };
  const { reads, trace } = readsFor({ input, rows: [], passed: new Set(), snapshots: new Map() });
  const choice = await chooseTodayFrom(input, reads);
  assert.deepStrictEqual(choice, { dealIds: [], nearMiss: false, advice: null });
  // The day's pool, then the budget-lifted pool; no areas, so no search outside them.
  assert.equal(trace.length, 2);
  assert.ok(trace.every((t) => t.startsWith('pool ')));
});
