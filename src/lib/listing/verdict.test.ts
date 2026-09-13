import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseDeal, rentToRentDeal } from './deal.ts';
import { areaVerdict, dealVerdict, formatTrackValue } from './verdict.ts';
import type { QuickEstimate } from './quick-types.ts';

const area: QuickEstimate['area'] = {
  code: 'M',
  slug: 'manchester',
  name: 'Manchester',
  score: 74,
  grade: 'B',
  gradeLabel: 'Strong',
  confidence: { tier: 'confirmed', label: 'Confirmed' },
  competition: { label: 'Opportunity', intensity: 33, tone: 'works' },
  seasonality: { score: 70, label: 'Seasonal' },
  directBooking: { score: 62, label: 'Strong' },
  licensing: { status: 'confirmed-unrestricted', headline: 'No STR licence required (yet)' },
  managedByStayful: false,
  trend: { direction: 'up', label: 'Rising enquiries' },
  bedroomStat: { bedrooms: 2, samples: 41, grossRevenue: 31200, adr: 142, occupancy: 61 },
  headline: { grossRevenue: 30000, adr: 140, occupancy: 60, totalSamples: 120 },
};

function quickFor(grossRevenue: number, adr: number, occupancy: number, extra: Partial<QuickEstimate> = {}): QuickEstimate {
  return { area, estimate: { grossRevenue, adr, occupancy, source: 'area-bedrooms', note: 'Manchester average for 2-bed properties (41 reports)', updatedAt: null, stale: false }, competitors: null, tracked: null, trackedMissing: false, pmiMarket: null, deal: null, limited: false, ...extra };
}

test('a purchase over the yield target works, with the ceiling price', () => {
  const deal = purchaseDeal(220_000, { grossRevenue: 31_200, adr: 142, bedrooms: 2 });
  const v = dealVerdict({ kind: 'sale', price: { amount: 220_000, period: 'total' }, bedrooms: 2, deal, quick: quickFor(31_200, 142, 61) });
  assert.equal(v.tone, 'works');
  assert.equal(v.headline, 'Works at £220,000');
  assert.match(v.sentence, /14\.2% gross yield against your 10% target/);
  assert.match(v.ceiling ?? '', /£312,000/);
  assert.equal(v.number, '14.2%');
  assert.equal(v.keys.length, 4);
  assert.equal(v.keys[3].value, 'None required');
  assert.ok(v.track && v.track.me === 14.2 && v.track.target === 10);
});

test('a purchase just under target is tight and names the price that works', () => {
  const deal = purchaseDeal(185_000, { grossRevenue: 16_800, adr: 108, bedrooms: 2 });
  const v = dealVerdict({ kind: 'sale', price: { amount: 185_000, period: 'total' }, bedrooms: 2, deal, quick: quickFor(16_800, 108, 52) });
  assert.equal(v.tone, 'tight');
  assert.equal(v.headline, 'Tight at £185,000');
  assert.match(v.sentence, /a month short after the mortgage/);
  assert.match(v.sentence, /£168,000 or below/);
  assert.equal(v.keys[2].tone, 'no');
});

test('a purchase well under target does not work', () => {
  const deal = purchaseDeal(400_000, { grossRevenue: 20_000, adr: 100, bedrooms: 2 });
  const v = dealVerdict({ kind: 'sale', price: { amount: 400_000, period: 'total' }, bedrooms: 2, deal, quick: quickFor(20_000, 100, 50) });
  assert.equal(v.tone, 'no');
  assert.match(v.headline, /Doesn’t work/);
});

test('rent-to-rent with a losing margin does not work and gives the rent ceiling', () => {
  const deal = rentToRentDeal(1195, { grossRevenue: 31_200, adr: 142, bedrooms: 2 });
  const v = dealVerdict({ kind: 'rent', price: { amount: 1195, period: 'pcm' }, bedrooms: 2, deal, quick: quickFor(31_200, 142, 61) });
  assert.equal(v.tone, 'no');
  assert.equal(v.headline, 'Doesn’t work at £1,195 a month');
  assert.match(v.sentence, /Loses £93 a month/);
  assert.match(v.sentence, /£602 or below/);
  assert.equal(v.number, '−£93/mo');
  assert.equal(v.keys[1].sub, 'area runs at 61%');
});

test('rent-to-rent over the margin target works', () => {
  const deal = rentToRentDeal(600, { grossRevenue: 31_200, adr: 142, bedrooms: 2 });
  const v = dealVerdict({ kind: 'rent', price: { amount: 600, period: 'pcm' }, bedrooms: 2, deal, quick: quickFor(31_200, 142, 61) });
  assert.equal(v.tone, 'works');
  assert.match(v.sentence, /against your £500 target/);
});

test('a tracked Airbnb is a benchmark against the area', () => {
  const tracked = { listingId: '1', name: 'Cosy House', url: '', lat: 0, lng: 0, bedrooms: 4, bathrooms: 2, guests: 8, roomType: '', propertyType: '', annualRevenue: 44_100, adr: 210, occupancy: 0.58, reviewCount: 74, rating: 4.91, activeDays: 365, provider: 'airbtics', updatedAt: null };
  const quick = quickFor(38_000, 180, 55, { tracked, area: { ...area, bedroomStat: { bedrooms: 4, samples: 19, grossRevenue: 38_000, adr: 180, occupancy: 55 } } });
  const v = dealVerdict({ kind: 'str', price: null, bedrooms: 4, deal: null, quick });
  assert.equal(v.tone, 'info');
  assert.equal(v.headline, 'Earning about £44,100 a year');
  assert.match(v.sentence, /16% above a typical 4-bed here/);
  assert.equal(v.track?.targetLabel, 'Area 4-bed £38k');
  assert.equal(v.numberLabel, 'earns / yr');
});

test('an untracked Airbnb falls back to the area figure and says so', () => {
  const v = dealVerdict({ kind: 'str', price: null, bedrooms: 2, deal: null, quick: quickFor(31_200, 142, 61, { trackedMissing: true }) });
  assert.equal(v.tone, 'info');
  assert.match(v.headline, /earns about £31,200 a year/);
  assert.match(v.sentence, /does not track this listing/);
});

test('no estimate at all is honest', () => {
  const v = dealVerdict({ kind: 'sale', price: { amount: 100_000, period: 'total' }, bedrooms: 2, deal: null, quick: null });
  assert.equal(v.tone, 'unknown');
  assert.equal(v.number, '—');
  assert.equal(v.keys.length, 0);
});

test('no estimate with reasons says what each rung needed and what unlocks a figure', () => {
  const noEstimate = {
    reasons: [
      { source: 'postcode-reports' as const, label: 'Stayful reports for this postcode', needed: 1, found: 0, status: 'short' as const, detail: 'Need 1 Stayful report for NG7 1AB with 2 bedrooms in the last 90 days; found 0.' },
      { source: 'competitors' as const, label: 'Tracked Airbnbs within 1 km', needed: 3, found: 1, status: 'short' as const, detail: 'Need 3 tracked 2-bed Airbnbs earning within 1 km; found 1 of 9 tracked.' },
      { source: 'area' as const, label: 'Area average across all sizes', needed: 1, found: null, status: 'unavailable' as const, detail: 'No area data for this postcode yet.' },
    ],
    summary: 'Need 1 Stayful report for NG7 1AB with 2 bedrooms in the last 90 days; found 0. Need 3 tracked 2-bed Airbnbs earning within 1 km; found 1 of 9 tracked.',
    unlock: 'Run the full report: it searches live comparables around the exact address.',
  };
  const quick: QuickEstimate = { area: null, estimate: null, competitors: null, tracked: null, trackedMissing: false, pmiMarket: null, deal: null, limited: false, noEstimate };
  const v = dealVerdict({ kind: 'sale', price: { amount: 100_000, period: 'total' }, bedrooms: 2, deal: null, quick });
  assert.equal(v.tone, 'unknown');
  assert.match(v.sentence, /Need 1 Stayful report/);
  assert.match(v.sentence, /Run the full report/);
  assert.equal(v.keys.length, 2);
  assert.equal(v.keys[0].value, '0 of 1');
  assert.equal(v.keys[1].value, '1 of 3');
  assert.equal(v.ceiling, noEstimate.unlock);
  // a stored quick view from before the reasons existed still reads
  const legacy = dealVerdict({ kind: 'sale', price: null, bedrooms: 2, deal: null, quick: { ...quick, noEstimate: undefined } });
  assert.match(legacy.sentence, /no revenue figures for this postcode yet/);
});

test('a limited quick view says lookups were skipped', () => {
  const deal = purchaseDeal(220_000, { grossRevenue: 31_200, adr: 142, bedrooms: 2 });
  const v = dealVerdict({ kind: 'sale', price: { amount: 220_000, period: 'total' }, bedrooms: 2, deal, quick: quickFor(31_200, 142, 61, { limited: true }) });
  assert.match(v.sentence, /Some lookups were skipped/);
});

test('area verdict with goals: warnings first, three reasons, fit tone', () => {
  const v = areaVerdict({
    name: 'Nottingham',
    code: 'NG',
    bedroom: 2,
    grossRevenue: 24_600,
    occupancy: 58,
    adr: 118,
    yieldPct: 12.1,
    samples: 30,
    grade: 'B',
    gradeLabel: 'Strong',
    competition: 'Busy but beatable',
    directBooking: 'Moderate',
    directBookingScore: 48,
    seasonality: { score: 81, label: 'Steady' },
    licensing: { status: 'confirmed-unrestricted', headline: 'No STR licence required (yet)', regionLabel: 'England' },
    trend: 'flat',
    fit: { score: 77, inBudget: true, hasBedrooms: true, inRange: false, distanceMiles: 61 },
    targetYieldPct: 10,
  });
  assert.equal(v.tone, 'works');
  assert.equal(v.headline, 'Nottingham fits your goals');
  assert.deepEqual(v.reasons, ['61 mi, beyond your range', 'Competitive market', 'Fits your budget']);
  assert.equal(v.number, '£25k');
  assert.equal(v.numberLabel, 'avg rev / yr');
  assert.equal(v.fit, 77);
  assert.deepEqual(v.keys.map((k) => k.label), ['Avg revenue', 'Occupancy', 'Daily rate', 'Gross yield', 'Direct booking', 'Seasonality', 'Competition', 'Licensing']);
  assert.equal(v.keys[0].value, '£24,600');
  assert.equal(v.keys[1].value, '58%');
  assert.equal(v.keys[2].value, '£118');
  assert.equal(v.keys[6].tone, 'tight');
});

test('area verdict reasons follow the competition bands and seasonality', () => {
  const base = { name: 'Hull', code: 'HU', bedroom: null, grossRevenue: 20_000, occupancy: 55, adr: 100, yieldPct: null, samples: 12, grade: 'C', gradeLabel: 'Moderate', directBooking: null, directBookingScore: null, licensing: { status: 'unconfirmed' as const, headline: 'Licensing status unconfirmed', regionLabel: 'England' }, trend: null, fit: null, targetYieldPct: null };
  assert.ok(areaVerdict({ ...base, competition: 'Opportunity', seasonality: null }).reasons.includes('Room for new listings'));
  assert.ok(areaVerdict({ ...base, competition: 'Weak', seasonality: null }).reasons.includes('Weak short-let demand'));
  assert.ok(areaVerdict({ ...base, competition: 'Competitive', seasonality: { score: 20, label: 'Highly seasonal' } }).reasons.includes('Highly seasonal income'));
  const v = areaVerdict({ ...base, competition: null, seasonality: null });
  assert.equal(v.number, '£20k');
  assert.equal(v.numberLabel, 'avg rev / yr');
});

test('area verdict without goals is informational', () => {
  const v = areaVerdict({ name: 'Bristol', code: 'BS', bedroom: null, grossRevenue: null, occupancy: null, adr: null, yieldPct: null, samples: 0, grade: null, gradeLabel: null, competition: null, directBooking: null, directBookingScore: null, seasonality: null, licensing: { status: 'unconfirmed', headline: 'Licensing status unconfirmed', regionLabel: 'England' }, trend: null, fit: null, targetYieldPct: null });
  assert.equal(v.tone, 'info');
  assert.equal(v.headline, 'Bristol');
  assert.equal(v.number, '—');
  assert.match(v.sentence, /Not enough reports yet/);
});

test('track values format by unit', () => {
  assert.equal(formatTrackValue(10, 'pct'), '10%');
  assert.equal(formatTrackValue(14.2, 'pct'), '14.2%');
  assert.equal(formatTrackValue(38_000, 'gbpk'), '£38k');
  assert.equal(formatTrackValue(-300, 'gbp'), '−£300');
});
