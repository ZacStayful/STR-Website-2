import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_SWATCHES, setupBack, setupResume } from './setup.ts';
import { parseHexColour } from '../funnels/brand.ts';

const none = { packOffered: false, hasFunnel: false, detailsSaved: false, deliveryDone: false, live: false };

test('a refresh carries on from the first step not yet done', () => {
  assert.equal(setupResume({ ...none, packOffered: true }), '/leads/setup');
  assert.equal(setupResume(none), '/leads/setup/company');
  assert.equal(setupResume({ ...none, hasFunnel: true }), '/leads/setup/details');
  assert.equal(setupResume({ ...none, hasFunnel: true, detailsSaved: true }), '/leads/setup/delivery');
  assert.equal(setupResume({ ...none, hasFunnel: true, detailsSaved: true, deliveryDone: true }), '/leads/setup/live');
  assert.equal(setupResume({ ...none, hasFunnel: true, detailsSaved: true, live: true }), '/leads/setup/live');
  // Once the funnel exists the pack is not put in front of it again.
  assert.equal(setupResume({ ...none, packOffered: true, hasFunnel: true }), '/leads/setup/details');
});

test('Back goes to the step before', () => {
  assert.equal(setupBack(1, true), '/leads/setup?back=1');
  assert.equal(setupBack(1, false), null);
  assert.equal(setupBack(2, false), '/leads/setup/company');
  assert.equal(setupBack(3, false), '/leads/setup/details');
  assert.equal(setupBack('live', false), '/leads/setup/delivery');
});

test('eight swatches, each a colour the brand accepts', () => {
  assert.equal(BRAND_SWATCHES.length, 8);
  for (const c of BRAND_SWATCHES) assert.ok(parseHexColour(c), c);
});
