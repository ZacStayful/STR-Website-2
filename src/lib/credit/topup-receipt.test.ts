import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The plan listed "confirm an AUTO top-up sends a receipt, not just a manual
 * one" as work. Reading the code showed it already does.
 *
 * The auto top-up half is a real test now: src/lib/stripe/auto-topup.test.ts
 * runs the rule (auto-topup-core.ts) with fake dependencies and asserts the
 * grant is given the member's email. The three checks below are SOURCE-TEXT
 * PINS, not behaviour: grants.ts and billing.ts import `server-only` and the
 * Supabase client, so the receipt path cannot run under node --test. They
 * catch the exact regressions that matter (grantTopup no longer looking at
 * the email, the receipt no longer naming the amount) and nothing subtler.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url).pathname, 'utf8');

test('pin: grantTopup sends the receipt whenever it has an email', () => {
  const src = read('../stripe/grants.ts');
  const fn = src.slice(src.indexOf('export async function grantTopup'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /opts\.email/, 'grantTopup no longer looks at opts.email');
  assert.match(body, /topupReceiptEmail/, 'grantTopup no longer sends a receipt');
});

test('pin: the receipt email still exists and names the amount', () => {
  const src = read('../email/billing.ts');
  assert.match(src, /export function topupReceiptEmail\(/);
  assert.match(src, /Receipt: \$\{formatGbp\(opts\.amountPence\)\}/);
});

test('pin: the pre-charge warning is a separate email from the low-balance one', () => {
  // They say different things — one is "you are running out", the other is
  // "a payment is about to be taken" — and collapsing them would lose the
  // notice the plan added this for.
  const src = read('../email/billing.ts');
  assert.match(src, /export function topupComingEmail\(/);
  assert.match(src, /export function lowBalanceEmail\(/);
});
