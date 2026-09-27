import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisQuote, quoteMatches, purchaseStale, runWindowClosed, analysisMessage, analysisHttpStatus, analysisDescription, ANALYSIS_STALE_MS, RUN_START_WINDOW_MS } from './deal-analysis-rules.ts';

const PRICING = { fullAnalysisPence: 400, pmiAddonPence: 200 };

test('an unopened deal: the button is the fixed price, taken as the quick look and the rest', () => {
  const q = analysisQuote({ admin: false, pricing: PRICING, opened: false, openPaidBasePence: null, openPricePence: 60, withPmi: false });
  assert.equal(q.opened, false);
  assert.equal(q.due.purchaseBasePence, 400);
  assert.equal(q.due.openBasePence, 60);
  assert.equal(q.due.analysisBasePence, 340);
});

test('an opened deal: the difference; with PMI, £2 more', () => {
  assert.equal(analysisQuote({ admin: false, pricing: PRICING, opened: true, openPaidBasePence: 60, openPricePence: 60, withPmi: false }).due.purchaseBasePence, 340);
  assert.equal(analysisQuote({ admin: false, pricing: PRICING, opened: true, openPaidBasePence: 60, openPricePence: 60, withPmi: true }).due.purchaseBasePence, 540);
});

test('an admin pays nothing and needs no open', () => {
  const q = analysisQuote({ admin: true, pricing: PRICING, opened: false, openPaidBasePence: null, openPricePence: 60, withPmi: true });
  assert.equal(q.opened, true);
  assert.equal(q.due.purchaseBasePence, 0);
  assert.equal(q.due.pmiBasePence, 0);
});

test('only the confirmed price is charged', () => {
  const due = { purchaseBasePence: 340 };
  assert.equal(quoteMatches(340, due), true);
  assert.equal(quoteMatches('340', due), true);
  assert.equal(quoteMatches(400, due), false);
  assert.equal(quoteMatches(null, due), false);
  assert.equal(quoteMatches(undefined, due), false);
  assert.equal(quoteMatches('', due), false);
});

test('a pending purchase is abandoned only once nothing has touched it for three minutes', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  assert.equal(purchaseStale({ created_at: at(10_000), ready_at: null, run_started_at: null }, now), false);
  assert.equal(purchaseStale({ created_at: at(ANALYSIS_STALE_MS + 1), ready_at: null, run_started_at: null }, now), true);
  // A run that started recently is alive, however old the claim.
  assert.equal(purchaseStale({ created_at: at(9 * 60_000), ready_at: at(9 * 60_000), run_started_at: at(30_000) }, now), false);
  assert.equal(purchaseStale({ created_at: at(9 * 60_000), ready_at: at(9 * 60_000), run_started_at: at(ANALYSIS_STALE_MS) }, now), true);
  assert.equal(purchaseStale({ created_at: 'nonsense', ready_at: null, run_started_at: null }, now), true);
});

test('the run must be asked for within ten minutes of the start', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  assert.equal(runWindowClosed({ ready_at: null }, now), false);
  assert.equal(runWindowClosed({ ready_at: new Date(now.getTime() - 60_000).toISOString() }, now), false);
  assert.equal(runWindowClosed({ ready_at: new Date(now.getTime() - RUN_START_WINDOW_MS).toISOString() }, now), true);
});

test('a failure after a one-tap open says the quick look stays, and nothing else was charged', () => {
  assert.match(analysisMessage('incomplete', { openedByPurchase: true }), /wasn’t charged.*Quick look stays charged/);
  assert.match(analysisMessage('insufficient_credit', { openedByPurchase: true }), /only the Quick look was charged/);
  assert.doesNotMatch(analysisMessage('incomplete'), /Quick look stays/);
  assert.match(analysisMessage('price_changed'), /Nothing was charged/);
});

test('status codes the client can act on', () => {
  assert.equal(analysisHttpStatus('insufficient_credit'), 402);
  assert.equal(analysisHttpStatus('already_done'), 409);
  assert.equal(analysisHttpStatus('no_postcode'), 422);
  assert.equal(analysisHttpStatus('just_gone'), 410);
  assert.equal(analysisHttpStatus('failed'), 500);
});

test('the ledger line names the area, never the address', () => {
  assert.equal(analysisDescription({ town: 'Manchester', postcode_area: 'M', kind: 'sale' }, false), 'Full analysis: Manchester, M (to buy)');
  assert.equal(analysisDescription({ town: null, postcode_area: null, kind: 'rent' }, true), 'Full analysis: a deal (rent-to-rent), from a saved analysis');
});
