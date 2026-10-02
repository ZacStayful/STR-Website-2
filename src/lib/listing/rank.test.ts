import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankForMember, returnOnCashLift, returnOnCashPct, ROC_LIFT_MAX, toPickFeedback, type Precheck, type StoredFeedbackRow } from './rank.ts';
import { applyCandidateFeedback, cleanReasons, feedbackRules, PICK_REASONS, type PickFeedback, type PickReason } from './picks.ts';
import { dealForSourced, rankPicksByBand, type RankCandidate, type SourcedListing } from './sourcing.ts';
import { isSendable, screeningScore, type Band, type Screening } from './screen.ts';
import { findOutcode } from './html.ts';
import type { MotivationMode } from '../market/goals.ts';
import type { AppliedRules } from './picks.ts';

// ─── The code as it stood in picks-run.ts before the extraction ─────────
// Copied verbatim (only the member-scoped names turned into parameters) so the
// shared function is pinned to what the daily picks run actually did. Do not
// "tidy" these: they are the reference, not an implementation.

type Cand = RankCandidate & { precheck: Precheck; screening?: Screening | null };

function legacyRank(candidates: Cand[], feedback: PickFeedback[], rules: AppliedRules, SPREAD_DEPTH: number, mode: MotivationMode) {
  const screened: Partial<Record<Band, number>> = {};
  const afterFeedback = applyCandidateFeedback(candidates, feedback, rules);
  const kept = afterFeedback.filter((c) => {
    if (!c.screening) return true;
    screened[c.screening.band] = (screened[c.screening.band] ?? 0) + 1;
    return isSendable(c.screening);
  });
  const list = rankPicksByBand(kept, SPREAD_DEPTH, mode);
  const ok = list.filter((p) => p.precheck === 'ok');
  const unknown = rules.strictSuitability ? [] : list.filter((p) => p.precheck !== 'ok');
  const gated = afterFeedback.length > 0 && kept.length === 0;
  return { afterFeedback, kept, screened, ranked: [...ok, ...unknown], gated };
}

function legacyFeedback(r: StoredFeedbackRow, l: SourcedListing | null, screening: Screening | null): PickFeedback {
  const amount = l?.price ? (l.kind === 'rent' ? (l.price.period === 'pw' ? Math.round((l.price.amount * 52) / 12) : l.price.amount) : l.price.period === 'total' ? l.price.amount : null) : null;
  return {
    reaction: r.reaction === 'yes' || r.reaction === 'no' ? r.reaction : null,
    reactionSource: r.reaction_source === 'form' || r.reaction_source === 'link' ? r.reaction_source : null,
    reasons: cleanReasons(r.reasons),
    kind: r.kind === 'sale' || r.kind === 'rent' ? r.kind : null,
    postcodeArea: typeof r.postcode_area === 'string' ? r.postcode_area : null,
    bedrooms: l?.bedrooms ?? null,
    amount,
    rawType: l?.rawType ?? null,
    outcode: l?.outcode ?? findOutcode(l?.postcode ?? l?.address ?? null),
    screeningScore: screeningScore(screening ?? null),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────

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
  return { int, pick, chance };
}

const listing = (over: Partial<SourcedListing>): SourcedListing => ({
  source: 'onthemarket', id: '1', canonicalUrl: 'https://www.onthemarket.com/details/1/', kind: 'sale',
  title: 'x', address: null, postcode: null, outcode: null, postcodeArea: null, lat: null, lng: null,
  bedrooms: 2, bathrooms: null, price: { amount: 200_000, period: 'total' }, rawType: null, photo: null,
  ...over,
});

const screening = (kind: 'sale' | 'rent', band: Band, score: number): Screening =>
  (kind === 'sale'
    ? { kind: 'purchase', band, upliftPct: score, surplus: score * 100 }
    : { kind: 'rent-to-rent', band, annualProfit: score, surplus: score }) as unknown as Screening;

const TYPES = [null, 'Flat', 'Apartment', 'Terraced house', 'Semi-detached house', 'Bungalow', 'Maisonette'];
const TITLES = ['2 bed property for sale', 'Spacious home', 'Needs modernisation throughout', 'Flat for sale', 'House in a quiet road', 'For sale by auction'];
const OUTCODES = ['NG1', 'NG2', 'NG7', 'DE1', 'M1', null];
const AREAS = ['NG', 'DE', 'M'];
const BANDS: Band[] = ['qualified', 'medium', 'unqualified', 'insufficient-data'];

function candidateFor(r: ReturnType<typeof rng>, i: number): Cand {
  const kind = r.chance(0.6) ? 'sale' : 'rent';
  const bedrooms = r.chance(0.1) ? null : r.int(1, 5);
  const price: SourcedListing['price'] = kind === 'sale'
    ? { amount: r.int(60, 600) * 1_000, period: 'total' }
    : r.chance(0.2) ? { amount: r.int(150, 700), period: 'pw' } : { amount: r.int(500, 3_000), period: 'pcm' };
  const l = listing({
    id: `l${i}`,
    canonicalUrl: `https://www.onthemarket.com/details/${i}/`,
    kind,
    bedrooms,
    price,
    rawType: r.pick(TYPES),
    title: r.pick(TITLES),
    outcode: r.pick(OUTCODES),
    postcodeArea: r.pick(AREAS),
    features: r.chance(0.1) ? ['Cash buyers only'] : [],
  });
  const gross = r.int(8, 60) * 1_000;
  const deal = dealForSourced(l, { byBedrooms: [{ bedrooms: bedrooms ?? 2, grossRevenue: gross, adr: Math.round(gross / 250) }], headline: { grossRevenue: gross, adr: Math.round(gross / 250) } }, null);
  const score = kind === 'sale' ? r.int(-20, 120) : r.int(-4_000, 30_000);
  const motivationScore = r.int(0, 100);
  return {
    listing: l,
    deal,
    areaFit: r.chance(0.1) ? null : r.int(0, 100),
    areaName: 'Somewhere',
    precheck: r.chance(0.7) ? 'ok' : 'unknown',
    screening: r.chance(0.15) ? null : screening(kind, r.pick(BANDS), score),
    motivation: r.chance(0.2) ? null : { score: motivationScore, firmScore: r.int(0, motivationScore), fired: [] },
    motivationQualifies: r.chance(0.2) ? undefined : r.chance(0.5),
  };
}

const REASON_KEYS = [...PICK_REASONS.map((x) => x.key), 'wrong_size', 'wrong_type'] as PickReason[];

function feedbackFor(r: ReturnType<typeof rng>, pool: Cand[]): PickFeedback[] {
  const out: PickFeedback[] = [];
  const n = r.int(0, 6);
  for (let i = 0; i < n; i += 1) {
    // Answers are usually about listings like the ones on offer, so the rules bite.
    const about = pool.length > 0 && r.chance(0.8) ? r.pick(pool) : candidateFor(r, 10_000 + i);
    const l = about.listing;
    const reasons = Array.from({ length: r.int(0, 3) }, () => r.pick(REASON_KEYS));
    out.push(
      legacyFeedback(
        { reaction: r.pick(['no', 'no', 'yes', null]), reaction_source: r.pick(['form', 'link', null]), reasons, kind: l.kind, postcode_area: l.postcodeArea },
        l,
        about.screening ?? null,
      ),
    );
  }
  return out;
}

// ─── The picks run is unchanged ─────────────────────────────────────────

test('with the return-on-cash lift off, rankForMember gives the picks run exactly what its inline ranking gave, pick included', () => {
  const seen = { withPick: 0, empty: 0, gated: 0, strict: 0, cut: 0, rulesBit: 0, unknownKept: 0 };
  for (let seed = 1; seed <= 600; seed += 1) {
    const r = rng(seed);
    const pool = Array.from({ length: r.int(0, 90) }, (_, i) => candidateFor(r, i));
    const feedback = feedbackFor(r, pool);
    const rules = feedbackRules(feedback);
    const depth = r.pick([40, 40, 5, 1]);
    const mode = r.pick<MotivationMode>(['off', 'prefer', 'only']);

    const before = legacyRank(pool, feedback, rules, depth, mode);
    const after = rankForMember(pool, feedback, rules, { depth, mode, returnOnCash: false });

    const where = `seed ${seed} (depth ${depth}, mode ${mode})`;
    assert.deepStrictEqual(after.ranked, before.ranked, `ranking differs: ${where}`);
    // The pick is the first of these whose page verifies; with every page
    // verifying it is simply the first, and it must be the same listing.
    assert.equal(after.ranked[0]?.listing.canonicalUrl, before.ranked[0]?.listing.canonicalUrl, `pick differs: ${where}`);
    assert.equal(after.gated, before.gated, `gated differs: ${where}`);
    assert.deepStrictEqual(after.screened, before.screened, `band counts differ: ${where}`);
    assert.deepStrictEqual(after.afterFeedback, before.afterFeedback, `feedback filter differs: ${where}`);
    assert.deepStrictEqual(after.kept, before.kept, `income gate differs: ${where}`);

    if (before.ranked.length > 0) seen.withPick += 1;
    else seen.empty += 1;
    if (before.gated) seen.gated += 1;
    if (rules.strictSuitability) seen.strict += 1;
    if (before.kept.length > depth) seen.cut += 1;
    if (before.afterFeedback.length < pool.length) seen.rulesBit += 1;
    if (before.ranked.some((p) => p.precheck === 'unknown')) seen.unknownKept += 1;
  }
  // A comparison that never reached a branch proves nothing about it.
  for (const [branch, n] of Object.entries(seen)) assert.ok(n > 0, `no seed exercised: ${branch}`);
});

test('toPickFeedback reads a stored answer exactly as the picks run did', () => {
  const rows: [StoredFeedbackRow, SourcedListing | null, Screening | null][] = [
    [{ reaction: 'no', reaction_source: 'form', reasons: ['too_expensive', 'poor_return'], kind: 'sale', postcode_area: 'NG' }, listing({ outcode: 'NG7', rawType: 'Flat', bedrooms: 3 }), screening('sale', 'qualified', 42)],
    [{ reaction: 'no', reaction_source: 'link', reasons: 'too_small,bogus,too_small', kind: 'rent', postcode_area: 'DE' }, listing({ kind: 'rent', price: { amount: 300, period: 'pw' }, postcode: 'DE1 3AA' }), screening('rent', 'medium', 9_500)],
    [{ reaction: 'yes', reaction_source: null, reasons: null, kind: 'rent', postcode_area: 'M' }, listing({ kind: 'rent', price: { amount: 1_250, period: 'pcm' }, address: '1 High St, Manchester M1 1AA' }), null],
    [{ reaction: 'maybe', reaction_source: 'email', reasons: 7, kind: 'lease', postcode_area: 12 }, null, null],
    [{ reaction: 'no', reaction_source: 'form', reasons: ['wrong_area'], kind: 'sale', postcode_area: 'NG' }, listing({ price: { amount: 950, period: 'pcm' } }), screening('sale', 'insufficient-data', 10)],
    [{ reaction: 'no', reaction_source: 'form', reasons: [], kind: 'sale', postcode_area: null }, listing({ price: null, bedrooms: null }), null],
  ];
  for (const [row, l, sc] of rows) assert.deepStrictEqual(toPickFeedback(row, l, sc), legacyFeedback(row, l, sc));
  // And the fields that matter read as intended.
  const rent = toPickFeedback(rows[1][0], rows[1][1], rows[1][2]);
  assert.equal(rent.amount, 1_300, '£300 pw is £1,300 pcm');
  assert.equal(rent.outcode, 'DE1', 'the outcode comes from the postcode when the snapshot has none');
  assert.deepEqual(rent.reasons, ['too_small']);
});

// ─── What the ranking does, stated plainly ─────────────────────────────

const plain = (id: string, over: Partial<Cand> = {}, l: Partial<SourcedListing> = {}): Cand => {
  const lst = listing({ id, canonicalUrl: `https://x/${id}`, rawType: 'Terraced house', ...l });
  return {
    listing: lst,
    deal: dealForSourced(lst, { byBedrooms: [{ bedrooms: 2, grossRevenue: 30_000, adr: 140 }], headline: { grossRevenue: 30_000, adr: 140 } }, null),
    areaFit: 60,
    areaName: 'Nottingham',
    precheck: 'ok',
    screening: screening('sale', 'qualified', 50),
    ...over,
  };
};
const NO_FEEDBACK = feedbackRules([]);

test('listings that clear the short-let check on the card come before ones that need the page', () => {
  const better = plain('needs-page', { precheck: 'unknown', areaFit: 95 });
  const worse = plain('card-ok', { areaFit: 20 });
  const { ranked } = rankForMember([better, worse], [], NO_FEEDBACK, { depth: 40, mode: 'off' });
  assert.deepEqual(ranked.map((p) => p.listing.id), ['card-ok', 'needs-page']);
});

test('"could not be run as a short let" drops everything the card alone cannot clear', () => {
  const said = [legacyFeedback({ reaction: 'no', reaction_source: 'form', reasons: ['not_str_suitable'], kind: 'sale', postcode_area: 'NG' }, null, null)];
  const rules = feedbackRules(said);
  assert.equal(rules.strictSuitability, true);
  const { ranked } = rankForMember([plain('needs-page', { precheck: 'unknown' }), plain('card-ok')], said, rules, { depth: 40, mode: 'off' });
  assert.deepEqual(ranked.map((p) => p.listing.id), ['card-ok']);
});

test('gated says the income bar emptied the list, not the market', () => {
  const unqualified = [plain('a', { screening: screening('sale', 'unqualified', 5) }), plain('b', { screening: screening('sale', 'insufficient-data', 0) })];
  const bar = rankForMember(unqualified, [], NO_FEEDBACK, { depth: 40, mode: 'off' });
  assert.deepEqual(bar.ranked, []);
  assert.equal(bar.gated, true);
  assert.deepEqual(bar.screened, { unqualified: 1, 'insufficient-data': 1 });

  const nothing = rankForMember([], [], NO_FEEDBACK, { depth: 40, mode: 'off' });
  assert.equal(nothing.gated, false, 'an empty market is not the bar');
});

test('only candidates that survive the feedback rules are counted at the income bar', () => {
  const said = [legacyFeedback({ reaction: 'no', reaction_source: 'form', reasons: ['no_houses'], kind: 'sale', postcode_area: 'NG' }, null, null)];
  const house = plain('house', { screening: screening('sale', 'medium', 20) });
  const flat = plain('flat', {}, { rawType: 'Flat' });
  const result = rankForMember([house, flat], said, feedbackRules(said), { depth: 40, mode: 'off' });
  assert.deepEqual(result.ranked.map((p) => p.listing.id), ['flat']);
  assert.deepEqual(result.screened, { qualified: 1 }, 'the house was ruled out before the bar and is not in its count');
});

test('"return too low" is measured on the screening the answer was about', () => {
  const said = [toPickFeedback({ reaction: 'no', reaction_source: 'form', reasons: ['poor_return'], kind: 'sale', postcode_area: 'NG' }, listing({}), screening('sale', 'qualified', 45))];
  const low = plain('low', { screening: screening('sale', 'qualified', 40) });
  const high = plain('high', { screening: screening('sale', 'qualified', 60) });
  const { ranked } = rankForMember([low, high], said, feedbackRules(said), { depth: 40, mode: 'off' });
  assert.deepEqual(ranked.map((p) => p.listing.id), ['high']);
});

// ─── Batch 22c: return on cash as a ranking factor ─────────────────────

/** A purchase as the ranking sees it: the cash in, the screening's surplus, a yield that tops out the deal points (as nearly every live deal does). */
const roc = (id: string, price: number, cash: number, profit: number, areaFit = 60, band: Band = 'qualified'): Cand => ({
  listing: listing({ id, canonicalUrl: `https://x/${id}`, price: { amount: price, period: 'total' } }),
  deal: { kind: 'purchase', askingPrice: price, cashRequired: cash, grossYieldPct: 40, targetYieldPct: 10 } as unknown as Cand['deal'],
  areaFit,
  areaName: 'Somewhere',
  precheck: 'ok',
  screening: { kind: 'purchase', band, upliftPct: 50, surplus: profit } as unknown as Screening,
});

const order = (pool: Cand[], depth = 40) => rankForMember(pool, [], feedbackRules([]), { depth, mode: 'off' }).ranked.map((c) => `${c.listing.id}:${c.fit}`);

test('the lift: 1.5 fit points a percentage point of return on cash over 6%, at most 15; nothing for a rental', () => {
  assert.equal(ROC_LIFT_MAX, 15);
  assert.equal(returnOnCashLift(roc('a', 115_000, 61_860, 7_555)), 9, '12.2% → +9');
  assert.equal(returnOnCashLift(roc('b', 450_000, 164_000, 11_343)), 1, '6.9% → +1');
  assert.equal(returnOnCashLift(roc('c', 150_000, 62_000, 9_866)), 15, '15.9% → +15 (the most)');
  assert.equal(returnOnCashLift(roc('d', 500_000, 280_000, 8_000)), 0, '2.9% → 0, never below');
  assert.equal(returnOnCashPct(roc('a', 115_000, 61_860, 7_555))?.toFixed(1), '12.2');
  assert.equal(returnOnCashLift({ deal: null, screening: null }), 0);
  const rental = plain('r', {}, { kind: 'rent', price: { amount: 900, period: 'pcm' } });
  assert.equal(returnOnCashLift(rental), 0);
});

test('worked example 1: LA £115k at 12.2% beats E £450k at 6.9% on the same area fit (85 vs 77)', () => {
  assert.deepEqual(order([roc('E-450k', 450_000, 164_000, 11_343), roc('LA-115k', 115_000, 61_860, 7_555)]), ['LA-115k:85', 'E-450k:77']);
  // The dearer one needs about 15 more points of area fit to come first: at 74 the two tie on 85, at 76 it leads 87 to 85.
  assert.deepEqual(order([roc('E-450k', 450_000, 164_000, 11_343, 74), roc('LA-115k', 115_000, 61_860, 7_555)]).sort(), ['E-450k:85', 'LA-115k:85']);
  assert.equal(order([roc('E-450k', 450_000, 164_000, 11_343, 76), roc('LA-115k', 115_000, 61_860, 7_555)])[0], 'E-450k:87');
});

test('worked example 2: CA £150k at 15.9% beats E £425k at 7.3%, even when the dearer one sits in a much better area (91 vs 90)', () => {
  assert.deepEqual(order([roc('E-425k', 425_000, 155_250, 11_343), roc('CA-150k', 150_000, 62_000, 9_866)]), ['CA-150k:91', 'E-425k:78']);
  // Area fit 80 instead of 60: 48 + 40 = 88, +2 = 90.
  assert.deepEqual(order([roc('E-425k', 425_000, 155_250, 11_343, 80), roc('CA-150k', 150_000, 62_000, 9_866)]), ['CA-150k:91', 'E-425k:90']);
});

test('worked example 3: equal returns lift alike, so it favours return, not cheapness (ST £425k at 30.6% vs SA £119.5k at 24.9%)', () => {
  const ranked = rankForMember([roc('SA-119k', 119_500, 52_350, 13_039), roc('ST-425k', 425_000, 162_250, 49_612, 62)], [], feedbackRules([]), { depth: 40, mode: 'off' }).ranked;
  assert.deepEqual(ranked.map((c) => `${c.listing.id}:${c.fit}`), ['ST-425k:92', 'SA-119k:91'], 'both +15: a slightly better area wins');
});

test('the lift changes order, never eligibility: bands stay apart, the income bar still gates, and the depth cut comes after the lift', () => {
  // A medium deal with a huge return never passes a qualified one.
  assert.deepEqual(order([roc('medium', 100_000, 40_000, 20_000, 60, 'medium'), roc('qualified', 450_000, 164_000, 11_343, 60)]), ['qualified:77', 'medium:91']);
  // An unqualified deal is still gated out.
  assert.deepEqual(order([roc('unq', 100_000, 40_000, 20_000, 60, 'unqualified'), roc('q', 450_000, 164_000, 11_343)]), ['q:77']);
  // Depth 1: the high-return deal that ranked second before the lift is the one kept.
  assert.deepEqual(order([roc('E-450k', 450_000, 164_000, 11_343, 70), roc('LA-115k', 115_000, 61_860, 7_555)], 1), ['LA-115k:85']);
  assert.deepEqual(rankForMember([roc('E-450k', 450_000, 164_000, 11_343, 70), roc('LA-115k', 115_000, 61_860, 7_555)], [], feedbackRules([]), { depth: 1, mode: 'off', returnOnCash: false }).ranked.map((c) => c.listing.id), ['E-450k'], 'before Batch 22c the dearer one was kept');
  // Fit never passes 100.
  assert.equal(order([roc('top', 100_000, 40_000, 20_000, 100)])[0], 'top:100');
});
