import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECRET_VARS, verifyWebhook, webhookSecrets } from './webhook-secrets.ts';

const A = 'whsec_aaaaaaaaaaaaaaaa';
const B = 'whsec_bbbbbbbbbbbbbbbb';
const C = 'whsec_cccccccccccccccc';

// ---------------------------------------------------------------
// Collecting the secrets
// ---------------------------------------------------------------

test('no secrets configured yields an empty list', () => {
  assert.deepEqual(webhookSecrets({}), []);
  assert.deepEqual(webhookSecrets({ STRIPE_WEBHOOK_SECRET: '', STRIPE_WEBHOOK_SECRET2: '   ' }), []);
});

test('either variable alone works', () => {
  assert.deepEqual(webhookSecrets({ STRIPE_WEBHOOK_SECRET: A }), [A]);
  // The case that is broken today: only the second variable is set.
  assert.deepEqual(webhookSecrets({ STRIPE_WEBHOOK_SECRET2: B }), [B]);
});

test('both variables give both secrets, primary first', () => {
  // Order matters only for which is tried first, but it should be predictable.
  assert.deepEqual(
    webhookSecrets({ STRIPE_WEBHOOK_SECRET: A, STRIPE_WEBHOOK_SECRET2: B }),
    [A, B],
  );
});

test('one variable may hold a list', () => {
  // This is what makes the next endpoint or rotation a config-only change.
  assert.deepEqual(webhookSecrets({ STRIPE_WEBHOOK_SECRET: `${A},${B}` }), [A, B]);
  assert.deepEqual(webhookSecrets({ STRIPE_WEBHOOK_SECRET: `${A} ${B}` }), [A, B]);
  assert.deepEqual(webhookSecrets({ STRIPE_WEBHOOK_SECRET: `${A}, ${B} ,${C}` }), [A, B, C]);
});

test('blanks and duplicates are dropped', () => {
  assert.deepEqual(
    webhookSecrets({ STRIPE_WEBHOOK_SECRET: `${A},,${A}`, STRIPE_WEBHOOK_SECRET2: `${A}, ${B}` }),
    [A, B],
  );
});

test('the variable names are the two documented ones', () => {
  // Guards against a rename that would silently stop reading a live secret.
  assert.deepEqual([...SECRET_VARS], ['STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET2']);
});

// ---------------------------------------------------------------
// Verifying a delivery
// ---------------------------------------------------------------

/** Stands in for Stripe: verifies only for the one secret it was built with. */
function fakeStripe(correct: string) {
  return {
    webhooks: {
      constructEvent(body: string, signature: string, secret: string) {
        if (secret !== correct) throw new Error('No signatures found matching the expected signature');
        return { type: 'customer.subscription.updated', data: { object: { body, signature } } };
      },
    },
  } as never;
}

test('the first secret matching verifies at position 1', () => {
  const r = verifyWebhook(fakeStripe(A), '{}', 'sig', [A, B]);
  assert.equal(r?.position, 1);
  assert.equal(r?.event.type, 'customer.subscription.updated');
});

test('the second secret matching verifies at position 2', () => {
  // The live failure this change exists to fix: the delivery came from the new
  // endpoint, so only the second secret can verify it.
  const r = verifyWebhook(fakeStripe(B), '{}', 'sig', [A, B]);
  assert.equal(r?.position, 2);
  assert.equal(r?.event.type, 'customer.subscription.updated');
});

test('the position reflects where the secret sits, not how many there are', () => {
  assert.equal(verifyWebhook(fakeStripe(C), '{}', 'sig', [A, B, C])?.position, 3);
});

test('no matching secret returns null rather than throwing', () => {
  assert.equal(verifyWebhook(fakeStripe(C), '{}', 'sig', [A, B]), null);
});

test('an empty secret list returns null', () => {
  assert.equal(verifyWebhook(fakeStripe(A), '{}', 'sig', []), null);
});

test('a missing signature header returns null without consulting Stripe', () => {
  // A forged request with no header must not reach constructEvent at all.
  let called = false;
  const spy = { webhooks: { constructEvent() { called = true; return {}; } } } as never;
  assert.equal(verifyWebhook(spy, '{}', null, [A]), null);
  assert.equal(verifyWebhook(spy, '{}', '', [A]), null);
  assert.equal(called, false);
});

test('the raw body and signature reach Stripe unchanged', () => {
  // Signature verification is over the exact bytes; any reshaping breaks it.
  const body = '{"id":"evt_1","type":"customer.subscription.updated"}';
  const r = verifyWebhook(fakeStripe(A), body, 't=1,v1=abc', [A]);
  const passed = r?.event.data.object as unknown as { body: string; signature: string };
  assert.equal(passed.body, body);
  assert.equal(passed.signature, 't=1,v1=abc');
});
