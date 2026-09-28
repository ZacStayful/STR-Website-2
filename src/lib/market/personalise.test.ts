import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { LicensingStatus } from '../data/str-licensing.ts';
import { personaliseScore, personalInputFor, type PersonalInput } from './personalise.ts';
import { DEFAULT_GOALS, type MarketGoals } from './goals.ts';

const input = (over: Partial<PersonalInput> = {}): PersonalInput => ({
  code: 'M', grossYieldPct: 9, grossRevenue: 28000, occupancyPct: 63, competitionIntensity: 50,
  directBookingScore: 50, licensing: 'confirmed-unrestricted', propertyValueMid: 300000, bedroomsAvailable: [1, 2, 3],
  ...over,
});
const goals = (over: Partial<MarketGoals> = {}): MarketGoals => ({ ...DEFAULT_GOALS, ...over });

test('score is 0–100 and every component is explained', () => {
  const s = personaliseScore(input(), goals())!;
  assert.ok(s.score >= 0 && s.score <= 100);
  assert.equal(s.components.length, 7);
  for (const c of s.components) assert.ok(c.detail.length > 0);
});

test('perfect inputs score 100 regardless of weights', () => {
  const s = personaliseScore(input({ grossYieldPct: 20, grossRevenue: 60000, occupancyPct: 90, competitionIntensity: 0, directBookingScore: 100 }), goals())!;
  assert.equal(s.score, 100);
  assert.equal(s.grade, 'A');
});

test('priority extremes flip a ranking between a high-yield/busy area and a low-yield/open one', () => {
  const busyHighYield = input({ code: 'A', grossYieldPct: 13, competitionIntensity: 95 });
  const openLowYield = input({ code: 'B', grossYieldPct: 6, competitionIntensity: 5 });
  const yieldFirst = goals({ priorities: { yield: 3, revenue: 2, lowCompetition: 0, directBookings: 2 } });
  const quietFirst = goals({ priorities: { yield: 0, revenue: 2, lowCompetition: 3, directBookings: 2 } });
  assert.ok(personaliseScore(busyHighYield, yieldFirst)!.score > personaliseScore(openLowYield, yieldFirst)!.score);
  assert.ok(personaliseScore(openLowYield, quietFirst)!.score > personaliseScore(busyHighYield, quietFirst)!.score);
});

test('cautious vs tolerant moves a licensed area', () => {
  const licensed = input({ licensing: 'confirmed-licensed' });
  const cautious = personaliseScore(licensed, goals({ riskAppetite: 'cautious' }))!.score;
  const tolerant = personaliseScore(licensed, goals({ riskAppetite: 'tolerant' }))!.score;
  assert.ok(cautious < tolerant);
});

test('distance is dropped without a home, and scores by range with one', () => {
  const none = personaliseScore(input(), goals())!;
  assert.equal(none.components.find((c) => c.key === 'distance')!.earned, null);
  assert.equal(none.fit.distanceMiles, null);

  const home = { postcode: 'M1 1AE', lat: 53.48, lng: -2.24 }; // Manchester
  const near = personaliseScore(input({ code: 'M' }), goals({ home, maxDistanceMiles: 50 }))!;
  assert.ok(near.fit.distanceMiles! < 10);
  assert.equal(near.fit.inRange, true);
  const far = personaliseScore(input({ code: 'EH' }), goals({ home, maxDistanceMiles: 50 }))!;
  assert.equal(far.fit.inRange, false);
  assert.equal(far.components.find((c) => c.key === 'distance')!.earned, 0);
  assert.ok(far.score < near.score);

  const anywhere = personaliseScore(input({ code: 'EH' }), goals({ home, maxDistanceMiles: null }))!;
  assert.equal(anywhere.components.find((c) => c.key === 'distance')!.earned, null);
  assert.ok(anywhere.fit.distanceMiles! > 100);
});

test('budget and bedroom fit are flags, not score killers', () => {
  const s = personaliseScore(input({ propertyValueMid: 600000, bedroomsAvailable: [1] }), goals({ budget: 'u200', bedrooms: 3 }))!;
  assert.equal(s.fit.inBudget, false);
  assert.equal(s.fit.hasBedrooms, false);
  assert.ok(s.score > 0);
  const unknown = personaliseScore(input({ propertyValueMid: null }), goals({ budget: 'u200' }))!;
  assert.equal(unknown.fit.inBudget, null);
});

test('null when there is no performance data at all', () => {
  assert.equal(personaliseScore(input({ grossYieldPct: null, grossRevenue: null, occupancyPct: null }), goals()), null);
});

test('personalInputFor uses the goal bedroom group for the budget value, "4+" taking the smallest ≥4', () => {
  const card = {
    code: 'M', headline: { grossRevenue: 1, occupancy: 1, bedroomsAvailable: [2, 5] }, yieldOnCost: { grossYieldPct: 1, propertyValueMid: 999 },
    byBedrooms: [{ bedrooms: 2, propertyValueMid: 200 }, { bedrooms: 5, propertyValueMid: 500 }],
    competition: null, directBooking: null, licensing: { status: 'unconfirmed' },
  } as never;
  assert.equal(personalInputFor(card, goals({ bedrooms: 2 })).propertyValueMid, 200);
  assert.equal(personalInputFor(card, goals({ bedrooms: 4 })).propertyValueMid, 500);
  assert.equal(personalInputFor(card, goals({ bedrooms: 3 })).propertyValueMid, 999);
  assert.equal(personalInputFor(card, goals({ bedrooms: null })).propertyValueMid, 999);
});

// ─── Pinned ─────────────────────────────────────────────────────────────
// The Market Explorer, the daily picks run and Today (through blendFit's area
// fit) all rank on this score, and Batch 14's tailoring adds to it rather than
// re-weighing what it already weighs (home distance, licensing, self or
// managed). So it is pinned: 500 seeded areas and goals, every score, grade,
// fit flag and component, reduced to one digest. A change here changes every
// member's ranking; if one is meant, update the digest and say why.

test('personaliseScore is pinned', () => {
  let a = 20_260_928;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const maybe = <T>(v: T): T | null => (next() < 0.15 ? null : v);
  const round = (n: number | null) => (n === null ? null : Math.round(n * 1e6) / 1e6);
  const homes = [null, { postcode: 'NG1 1AA', lat: 52.9536, lng: -1.1505 }, { postcode: 'M1 1AE', lat: 53.48, lng: -2.24 }, { postcode: 'LS1 4AP', lat: null, lng: null }];
  const licensing: LicensingStatus[] = ['confirmed-unrestricted', 'confirmed-licensed', 'unconfirmed'];
  const out: unknown[] = [];
  for (let i = 0; i < 500; i += 1) {
    const home = pick(homes);
    const g = goals({
      home,
      maxDistanceMiles: home ? pick([null, 10, 25, 50, 100]) : null,
      budget: pick([null, 'u200', '200-350', '350-500', '500+'] as const),
      bedrooms: pick([null, 1, 2, 3, 4] as const),
      priorities: { yield: pick([0, 1, 2, 3] as const), revenue: pick([0, 1, 2, 3] as const), lowCompetition: pick([0, 1, 2, 3] as const), directBookings: pick([0, 1, 2, 3] as const) },
      management: pick(['self', 'managed'] as const),
      riskAppetite: pick(['cautious', 'balanced', 'tolerant'] as const),
    });
    const s = personaliseScore(
      input({
        code: pick(['NG', 'DE', 'LS', 'M', 'YO', 'EH', 'TR', 'ZZ']),
        grossYieldPct: maybe(int(20, 160) / 10),
        grossRevenue: maybe(int(10, 60) * 1_000),
        occupancyPct: maybe(int(30, 85)),
        competitionIntensity: maybe(int(0, 100)),
        directBookingScore: maybe(int(0, 100)),
        licensing: pick(licensing),
        propertyValueMid: maybe(int(80, 700) * 1_000),
        bedroomsAvailable: [1, 2, 3, 4, 5].filter(() => next() < 0.6),
      }),
      g,
    );
    out.push(s && [s.score, s.grade, s.gradeLabel, s.fit, s.components.map((c) => [c.key, round(c.weight), round(c.earned), c.detail])]);
  }
  const digest = createHash('sha256').update(JSON.stringify(out)).digest('hex').slice(0, 24);
  assert.equal(digest, 'c36ec0421ea93e8773e56e3c', 'personaliseScore changed');
  // Two of the 500, stated plainly.
  assert.equal(personaliseScore(input(), goals())!.score, 56);
  assert.equal(personaliseScore(input({ code: 'NG', licensing: 'confirmed-licensed' }), goals({ home: homes[1], maxDistanceMiles: 50, riskAppetite: 'cautious', management: 'self' }))!.score, 54);
});
