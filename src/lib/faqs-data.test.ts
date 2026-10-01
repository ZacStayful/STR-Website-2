import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costAnswer, costRest, DEFAULT_COST_FIGURES, FAQS, faqsWith } from './faqs-data.ts';

test('the cost answer is written from the figures, not typed', () => {
  const a = costAnswer({ costLead: null }, DEFAULT_COST_FIGURES);
  assert.equal(a, 'Every account starts with £20 of free credit, no card required — about five Full analyses of deals, or three with the PMI second opinion added. After that, subscribe for monthly credit from £19/month — current plans and annual saving are on the pricing page — or top up as you go from £10. Plan credit resets each month; top-up credit never expires but is spent at 1.3× the plan rate. Cancel any time, no contract.');
  assert.equal(FAQS.find((f) => f.q === 'What does it cost?')?.a, a, 'the static list carries the defaults');
});

test('a changed setting changes the answer everywhere it is shown', () => {
  const figures = { welcomePence: 2500, fullAnalysisPence: 500, pmiAddonPence: 250, minPlanPence: 2499, minTopupPence: 1500, topupRate: 1.25 };
  const a = costAnswer({ costLead: null }, figures);
  assert.match(a, /starts with £25 of free credit/);
  assert.match(a, /about five Full analyses of deals, or three with the PMI/);
  assert.match(a, /from £24\.99\/month/);
  assert.match(a, /top up as you go from £15\./);
  assert.match(a, /1\.25× the plan rate/);
  assert.equal(faqsWith({ costLead: null }, figures).find((f) => f.q === 'What does it cost?')?.a, a);
});

test('once the pack is live its lead replaces the welcome credit and the rest follows', () => {
  const lead = 'New members can start with a £10 starter pack: £30 of credit, about 7 Full analyses of deals. It never expires.';
  assert.equal(costAnswer({ costLead: lead }), `${lead} Or ${costRest(DEFAULT_COST_FIGURES)}`);
  assert.doesNotMatch(costAnswer({ costLead: lead }), /£20 of free credit/);
});

test('the other answers are untouched', () => {
  const live = faqsWith({ costLead: null });
  assert.equal(live.length, FAQS.length);
  for (const f of FAQS) if (f.q !== 'What does it cost?') assert.equal(live.find((x) => x.q === f.q)?.a, f.a);
});
