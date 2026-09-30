import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planForPriceId, priceIdForPlan, priceIdForTopup, topupPenceForPriceId, configuredPlanCodes, priceIdForStarterPack } from './prices.ts';

const env = { STRIPE_PRICE_STARTER: 'price_s', STRIPE_PRICE_PRO: 'price_p', STRIPE_PRICE_TOPUP_1000: 'price_t10' };

test('maps plan codes to and from price ids', () => {
  assert.equal(priceIdForPlan('pro', env), 'price_p');
  assert.equal(planForPriceId('price_p', env), 'pro');
  assert.equal(planForPriceId('price_unknown', env), null);
  assert.equal(planForPriceId(null, env), null);
  assert.equal(priceIdForPlan('scale', env), null);
});

test('maps top-up amounts to and from price ids', () => {
  assert.equal(priceIdForTopup(1000, env), 'price_t10');
  assert.equal(priceIdForTopup(2500, env), null);
  assert.equal(topupPenceForPriceId('price_t10', env), 1000);
});

test('lists the plans that have a price configured', () => {
  assert.deepEqual(configuredPlanCodes(env), ['starter', 'pro']);
});

test('Batch 20: the starter pack price comes from STRIPE_PRICE_STARTER_PACK and is never a plan or a top-up', () => {
  const env = { STRIPE_PRICE_STARTER_PACK: 'price_pack', STRIPE_PRICE_TOPUP_1000: 'price_t10' };
  assert.equal(priceIdForStarterPack(env), 'price_pack');
  assert.equal(priceIdForStarterPack({}), null);
  assert.equal(planForPriceId('price_pack', env), null);
  assert.equal(topupPenceForPriceId('price_pack', env), null);
});
