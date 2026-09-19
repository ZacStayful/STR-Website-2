import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The plan listed "confirm an AUTO top-up sends a receipt, not just a manual
 * one" as work. Reading the code showed it already does — so this pins the
 * behaviour rather than rebuilding it.
 *
 * It reads source rather than running the path, because the real one needs
 * Stripe and Supabase. That makes it a coarse guard, but it catches the exact
 * regression that matters: someone dropping the `email` argument, at which
 * point auto top-ups would silently stop sending receipts and a customer
 * would find out from their bank statement.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url).pathname, 'utf8');

test('an auto top-up passes the email through to the grant', () => {
  const src = read('../stripe/auto-topup.ts');
  const call = src.match(/grantTopup\([^)]*\)/);
  assert.ok(call, 'maybeAutoTopup no longer calls grantTopup');
  assert.match(call[0], /email/, 'grantTopup is called without an email — the receipt would not be sent');
});

test('grantTopup sends the receipt whenever it has an email', () => {
  const src = read('../stripe/grants.ts');
  const fn = src.slice(src.indexOf('export async function grantTopup'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /opts\.email/, 'grantTopup no longer looks at opts.email');
  assert.match(body, /topupReceiptEmail/, 'grantTopup no longer sends a receipt');
});

test('the receipt email still exists and names the amount', () => {
  const src = read('../email/billing.ts');
  assert.match(src, /export function topupReceiptEmail\(/);
  assert.match(src, /Receipt: \$\{formatGbp\(opts\.amountPence\)\}/);
});

test('the pre-charge warning is a separate email from the low-balance one', () => {
  // They say different things — one is "you are running out", the other is
  // "a payment is about to be taken" — and collapsing them would lose the
  // notice the plan added this for.
  const src = read('../email/billing.ts');
  assert.match(src, /export function topupComingEmail\(/);
  assert.match(src, /export function lowBalanceEmail\(/);
});
