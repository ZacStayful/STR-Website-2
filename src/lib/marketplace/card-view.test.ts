import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardView, NOT_OPENED } from './card-view.ts';
import { allocate, priceLabel, type GrantLite } from '../credit/deal-pricing.ts';
import { DEFAULT_DEAL_OPEN_LADDER } from './ladder.ts';

const PRICING = { fullAnalysisPence: 400, pmiAddonPence: 200, profitRangePct: { high: 10, medium: 15, low: 25 } };
const CARD = { kind: 'rent' as const, price_amount: 1200, price_period: 'pcm', bedrooms: 2, annual_profit: 30_000, uplift_pct: null, screening_gross: '40000', screening_confidence: 'medium' };
const planOnly: GrantLite[] = [{ id: 'p', kind: 'plan', priority: 1, remainingPence: 5000, spendRate: 1, expiresAt: null, createdAt: '2026-09-01T00:00:00Z' }];
const topupOnly: GrantLite[] = [{ id: 't', kind: 'topup', priority: 3, remainingPence: 5000, spendRate: 1.3, expiresAt: null, createdAt: '2026-09-01T00:00:00Z' }];
const labelFor = (grants: GrantLite[], admin = false) => (base: number) => priceLabel(allocate(grants, base), { admin, spendableBasePence: 10_000 });

test('unopened: both buttons, the one-tap total is the fixed price', () => {
  const v = cardView({ card: CARD, state: NOT_OPENED, admin: false, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label: labelFor(planOnly) });
  assert.ok(v.quickLook);
  assert.equal(v.fullAnalysis?.main, '£4');
  assert.equal(v.fullAnalysisBasePence, 400);
  assert.ok(v.range);
  assert.equal(v.uplift, null);
});

test('a top-up payer sees what they pay, and the plan price beside it', () => {
  const v = cardView({ card: CARD, state: NOT_OPENED, admin: false, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label: labelFor(topupOnly) });
  assert.equal(v.fullAnalysis?.main, '£5.20');
  assert.equal(v.fullAnalysis?.nudge, '£4 on a plan');
});

test('opened: no quick look, the full analysis is the difference', () => {
  const v = cardView({ card: CARD, state: { opened: true, openPaidBasePence: 60, reportId: null }, admin: false, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label: labelFor(planOnly) });
  assert.equal(v.quickLook, null);
  assert.equal(v.fullAnalysis?.main, '£3.40');
});

test('analysed: no price buttons at all', () => {
  const v = cardView({ card: CARD, state: { opened: true, openPaidBasePence: 60, reportId: 'r1' }, admin: false, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label: labelFor(planOnly) });
  assert.equal(v.analysed, true);
  assert.equal(v.fullAnalysis, null);
  assert.equal(v.quickLook, null);
});

test('an admin sees no prices', () => {
  const v = cardView({ card: CARD, state: NOT_OPENED, admin: true, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label: labelFor(planOnly, true) });
  assert.equal(v.fullAnalysis?.state, 'admin');
  assert.equal(v.quickLook?.state, 'admin');
});

test('a purchase keeps its long-let uplift as a tag', () => {
  const v = cardView({ card: { ...CARD, kind: 'sale', price_amount: 200_000, price_period: 'total', uplift_pct: 45 }, state: NOT_OPENED, admin: false, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label: labelFor(planOnly) });
  assert.equal(v.uplift, '+45% vs a long let');
});

test('Batch 16: the cash in / to start line, at the member’s own deposit for a purchase; an auction lot keeps its bridging cash', () => {
  const common = { state: NOT_OPENED, admin: false, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label: labelFor(planOnly) };
  const rental = cardView({ ...common, card: { ...CARD, deal_setup: '13000' } });
  assert.equal(rental.cash, '£13k to start');
  assert.equal(rental.lowEntry, false);

  const sale = { ...CARD, kind: 'sale' as const, price_amount: 120_000, price_period: 'total', uplift_pct: 45, outcode: 'CW1', deal_cash: '49000', deal_auction: null };
  const house = cardView({ ...common, card: sale });
  assert.equal(house.cash, '£49k cash in', 'the stored house figure without the member’s finance');
  assert.equal(house.lowEntry, true);
  // A 10% deposit: £12,000 + SDLT £6,000 + setup £13,000.
  const own = cardView({ ...common, card: sale, finance: { depositPct: 10 } });
  assert.equal(own.cash, '£31k cash in');
  assert.equal(own.lowEntry, true, 'Batch 22c: the stream is judged on the price');
  // A cash buyer puts the whole price in.
  assert.equal(cardView({ ...common, card: sale, finance: { depositPct: 10 }, cashBuyer: true }).cash, '£139k cash in');
  // An auction lot: the bridging cash whoever looks; cheap on its auction price (guide £130,000 → £149,500).
  const lot = cardView({ ...common, card: { ...sale, price_amount: 130_000, deal_cash: '85000', deal_price: '149500', deal_auction: 'modern' }, finance: { depositPct: 10 } });
  assert.equal(lot.cash, '£85k cash in');
  assert.equal(lot.lowEntry, true);
  assert.equal(cardView({ ...common, card: { ...sale, price_amount: 135_000, deal_cash: '85000', deal_price: '155250', deal_auction: 'traditional' } }).lowEntry, false, 'a guide within £150,000 at an auction price over it');
  assert.equal(cardView({ ...common, card: { ...sale, price_amount: 130_000, deal_cash: '85000', deal_auction: 'modern' } }).lowEntry, false, 'a lot read without its auction price: its guide is not its price');
  // A row read without the Batch 16 columns has no cash line; its listed price still decides the badge.
  const bare = cardView({ ...common, card: { ...CARD, kind: 'sale' as const, price_amount: 120_000, price_period: 'total', uplift_pct: 45 } });
  assert.equal(bare.cash, null);
  assert.equal(bare.lowEntry, true);
  assert.equal(cardView({ ...common, card: { ...sale, price_amount: 150_001 } }).lowEntry, false);
  assert.equal(cardView({ ...common, card: sale, lowEntry: { cheapMaxPrice: 100_000 } }).lowEntry, false, 'the bar is the setting');
  assert.equal(house.lenderNote, null, '£120,000 is over the lender minimum');
});

test('Batch 22c, Part E: a purchase under £75,000 carries the lender note, not a rental, not a cash buyer; the figures are unchanged', () => {
  const common = { state: NOT_OPENED, admin: false, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label: labelFor(planOnly) };
  const cheap = { ...CARD, kind: 'sale' as const, price_amount: 74_999, price_period: 'total', uplift_pct: 45, outcode: 'CW1', deal_cash: '34000', deal_auction: null };
  const v = cardView({ ...common, card: cheap });
  assert.equal(v.lenderNote, "Some lenders won't lend under about £75k. Check with a broker, or plan it as a cash buy.");
  assert.equal(v.cash, '£34k cash in');
  assert.equal(cardView({ ...common, card: { ...cheap, price_amount: 75_000 } }).lenderNote, null);
  assert.equal(cardView({ ...common, card: cheap, cashBuyer: true }).lenderNote, null);
  assert.equal(cardView({ ...common, card: { ...CARD, price_amount: 500 } }).lenderNote, null, 'a rental never');
  assert.equal(cardView({ ...common, card: cheap, lowEntry: { lenderMinPrice: 60_000 } }).lenderNote, null, 'the threshold is the setting');
});

test('Batch 16, Part C: the caption names the deal’s own comparables once checked, and the pay ceiling rests on them', () => {
  const view = cardView({ card: { ...CARD, screening_confidence: 'high', check_comps: 12 }, state: NOT_OPENED, admin: false, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label: labelFor(planOnly) });
  assert.equal(view.caption, 'based on 12 similar Airbnbs nearby');
  assert.equal(view.pay?.basis, 'checked');
  const before = cardView({ card: CARD, state: NOT_OPENED, admin: false, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label: labelFor(planOnly) });
  assert.equal(before.caption, 'area estimate');
  assert.equal(before.pay?.basis, 'area');
});
