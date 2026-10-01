import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INTELLIGENCE, INTELLIGENCE_KEYS, isRevealAccount, parseIntelligence } from './settings.ts';

const from = (rows: Record<string, unknown>) => parseIntelligence((k) => rows[k]);

test('the defaults are the brief, and the reveal is off until reveal_from is set', () => {
  assert.deepEqual(from({}), DEFAULT_INTELLIGENCE);
  assert.equal(DEFAULT_INTELLIGENCE.revealFrom, null);
  assert.equal(DEFAULT_INTELLIGENCE.signupSearchCapPence, 50);
  assert.equal(DEFAULT_INTELLIGENCE.deepSearchMarkup, 5);
  assert.equal(DEFAULT_INTELLIGENCE.revealAnalysisDiscountPct, 50);
  assert.equal(DEFAULT_INTELLIGENCE.deepFirstRunExtraPence, 100);
});

test('every key the schema seeds is parsed', () => {
  const seeded = ['reveal_from', 'accuracy_advanced_pct', 'reveal_low_match_pct', 'reveal_small_count', 'strong_match_pct', 'strong_match_min_checked', 'signup_search_cap_pence', 'signup_thin_stock', 'signup_search_fresh_hours', 'signup_confirm_live_max', 'signup_income_checks_max', 'signup_search_monthly_cap_pence', 'member_search_confirms_per_hour', 'deep_search_markup', 'deep_search_max_raw_pence', 'deep_search_monthly_cap_pence', 'deep_search_first_discount_pct', 'deep_search_nearby_areas', 'reveal_analysis_discount_pct', 'reveal_welcome_days', 'deep_first_run_extra_pence', 'reveal_auto_topup_amount_pence', 'reveal_auto_topup_threshold_pence', 'si_call_pence_per_min', 'si_text_pence', 'si_email_pence'];
  assert.deepEqual([...Object.values(INTELLIGENCE_KEYS)].sort(), [...seeded].sort());
});

test('stored values are read as numbers or strings; bad ones fall back', () => {
  const s = from({ accuracy_advanced_pct: '60', deep_search_markup: 4.5, strong_match_pct: 140, signup_thin_stock: 'lots', si_text_pence: 22.5 });
  assert.equal(s.accuracyAdvancedPct, 60);
  assert.equal(s.deepSearchMarkup, 4.5);
  assert.equal(s.strongMatchPct, 90);
  assert.equal(s.signupThinStock, 5);
  assert.equal(s.siTextPence, 22.5);
});

test('a new member is created at or after reveal_from; unknown is never new', () => {
  const s = from({ reveal_from: '2026-10-02T10:00:00Z' });
  assert.equal(isRevealAccount('2026-10-02T10:00:00Z', s), true);
  assert.equal(isRevealAccount('2026-10-02T09:59:59Z', s), false);
  assert.equal(isRevealAccount(null, s), false);
  assert.equal(isRevealAccount('2026-10-03T00:00:00Z', from({})), false);
});
