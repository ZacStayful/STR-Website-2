import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_OFFER_RULES, parseOfferRules, purchaseDiscount, rentDiscount, rulesFromForm } from './offer-rules.ts';

const valid = {
  purchase: [
    { minMonths: 0, minReductions: 0, discountPct: 0 },
    { minMonths: 6, minReductions: 0, discountPct: 5 },
    { minMonths: 6, minReductions: 2, discountPct: 8 },
  ],
  rentToRent: [
    { minWeeks: 0, discountPct: 0 },
    { minWeeks: 4, discountPct: 5 },
  ],
};

test('valid bands parse; nothing stored means nothing set', () => {
  assert.deepEqual(parseOfferRules(valid), valid);
  assert.deepEqual(parseOfferRules(null), NO_OFFER_RULES);
  assert.deepEqual(parseOfferRules('junk'), NO_OFFER_RULES);
  assert.deepEqual(parseOfferRules({ purchase: [], rentToRent: [] }), NO_OFFER_RULES);
});

test('one bad row switches off only its own kind', () => {
  const r = parseOfferRules({ ...valid, purchase: [...valid.purchase, { minMonths: 3, minReductions: 0, discountPct: 'lots' }] });
  assert.equal(r.purchase, null);
  assert.deepEqual(r.rentToRent, valid.rentToRent);
});

test('sanity limits reject typos', () => {
  const p = (row: Record<string, unknown>) => parseOfferRules({ purchase: [row] }).purchase;
  assert.equal(p({ minMonths: 0, minReductions: 0, discountPct: 51 }), null);
  assert.equal(p({ minMonths: 0, minReductions: 0, discountPct: -1 }), null);
  assert.equal(p({ minMonths: -1, minReductions: 0, discountPct: 5 }), null);
  assert.equal(p({ minMonths: 0, minReductions: 1.5, discountPct: 5 }), null);
  assert.equal(p({ minMonths: 121, minReductions: 0, discountPct: 5 }), null);
  assert.deepEqual(p({ minMonths: '3', discountPct: '4.5', extra: true }), [{ minMonths: 3, minReductions: 0, discountPct: 4.5 }]);
  const many = Array.from({ length: 13 }, () => ({ minWeeks: 0, discountPct: 1 }));
  assert.equal(parseOfferRules({ rentToRent: many }).rentToRent, null);
});

test('the biggest matching discount wins, whatever the row order', () => {
  const rules = parseOfferRules(valid).purchase;
  const reversed = [...rules!].reverse();
  for (const r of [rules, reversed]) {
    assert.equal(purchaseDiscount(r, 213, 2), 8);
    assert.equal(purchaseDiscount(r, 213, 1), 5);
    assert.equal(purchaseDiscount(r, 60, 3), 0);
  }
});

test('no age, no rules or no matching row gives no discount figure', () => {
  const rules = parseOfferRules(valid).purchase;
  assert.equal(purchaseDiscount(rules, null, 2), null);
  assert.equal(purchaseDiscount(null, 213, 2), null);
  assert.equal(purchaseDiscount([{ minMonths: 3, minReductions: 0, discountPct: 4 }], 30, 0), null);
});

test('rent-to-rent bands are matched on weeks', () => {
  const rules = parseOfferRules(valid).rentToRent;
  assert.equal(rentDiscount(rules, 27), 0);
  assert.equal(rentDiscount(rules, 28), 5);
  assert.equal(rentDiscount(rules, null), null);
});

test('rulesFromForm ignores blank rows and refuses a bad one', () => {
  const form = (values: Record<string, string>) => (name: string) => values[name] ?? null;
  assert.deepEqual(rulesFromForm(form({})), { purchase: [], rentToRent: [] });
  assert.deepEqual(rulesFromForm(form({ p_months_0: '6', p_pct_0: '5', r_weeks_2: '4', r_pct_2: '3' })), {
    purchase: [{ minMonths: 6, minReductions: 0, discountPct: 5 }],
    rentToRent: [{ minWeeks: 4, discountPct: 3 }],
  });
  assert.equal(rulesFromForm(form({ p_months_0: '6', p_pct_0: '' })), null);
  assert.equal(rulesFromForm(form({ r_weeks_0: '4', r_pct_0: '80' })), null);
});
