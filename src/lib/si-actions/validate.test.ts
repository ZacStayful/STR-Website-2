import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaCodes, checkPlan, dealTypeOf, memberAskedToRemove, type PlanContext, type PlanDeal, type ProposedStep } from './validate.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const OTHER = '99999999-9999-4999-8999-999999999999';

const deal = (dealId: string, o: Partial<PlanDeal> = {}): PlanDeal => ({ dealId, label: '2-bed flat in LS6', stage: 'watching', opened: true, analysed: false, ...o });

function ctx(o: Partial<PlanContext> = {}): PlanContext {
  return {
    deals: new Map([
      [A, deal(A)],
      [B, deal(B, { opened: false, stage: null })],
      [C, deal(C, { analysed: true })],
    ]),
    maxTargets: 50,
    question: 'analyse my kept deals, and check https://www.rightmove.co.uk/properties/123456?channel=RES_BUY and www.rightmove.co.uk/properties/1.',
    deepSearch: 'available',
    linkChecks: true,
    ...o,
  };
}

const step = (o: Partial<ProposedStep>): ProposedStep => ({ action: 'keep', dealId: null, stage: null, url: null, question: null, value: null, ...o });

test('anything that is not one of the eight kinds is dropped, never run', () => {
  for (const action of ['top_up', 'cancel_plan', 'delete_report', 'share_deal', 'notifications', 'send_message', 'pay']) {
    const r = checkPlan([step({ action, dealId: A })], ctx());
    assert.equal(r.steps.length, 0, action);
    assert.equal(r.dropped[0].reason, 'unknown', action);
  }
});

test('a deal must be one this answer looked up: another member’s, or an unseen id, is dropped', () => {
  const r = checkPlan([step({ action: 'full_analysis', dealId: OTHER }), step({ action: 'pass', dealId: 'not-a-uuid' })], ctx());
  assert.equal(r.steps.length, 0);
  assert.deepEqual(r.dropped.map((d) => d.reason), ['not_seen', 'not_seen']);
});

test('ids match whatever their case', () => {
  const r = checkPlan([step({ action: 'pass', dealId: A.toUpperCase() })], ctx());
  assert.equal(r.steps.length, 1);
});

test('an unopened deal can only be Kept or Passed: later stages are dropped as needs_open', () => {
  const r = checkPlan([step({ action: 'stage_move', dealId: B, stage: 'viewing' }), step({ action: 'keep', dealId: B })], ctx());
  assert.deepEqual(r.dropped.map((d) => d.reason), ['needs_open']);
  assert.deepEqual(r.steps, [{ kind: 'keep', dealId: B, label: '2-bed flat in LS6', stage: 'watching', from: null }]);
});

test('a move to the stage a deal is already at does nothing', () => {
  const r = checkPlan([step({ action: 'keep', dealId: A })], ctx());
  assert.equal(r.steps.length, 0);
  assert.equal(r.dropped[0].reason, 'already_there');
});

test('a bad stage is refused', () => {
  const r = checkPlan([step({ action: 'stage_move', dealId: A, stage: 'sold' })], ctx());
  assert.equal(r.dropped[0].reason, 'bad_value');
});

test('a full analysis of a deal that has its report is dropped; a Deep report becomes the add-on', () => {
  const r = checkPlan([step({ action: 'full_analysis', dealId: C }), step({ action: 'deep_report', dealId: C })], ctx());
  assert.equal(r.dropped[0].reason, 'already_done');
  assert.deepEqual(r.steps, [{ kind: 'deep_report', dealId: C, label: '2-bed flat in LS6', opened: true, addOn: true }]);
});

test('repeats are dropped and the order is kept', () => {
  const r = checkPlan([step({ action: 'full_analysis', dealId: A }), step({ action: 'full_analysis', dealId: B }), step({ action: 'full_analysis', dealId: A })], ctx());
  assert.deepEqual(r.steps.map((s) => ('dealId' in s ? s.dealId : null)), [A, B]);
  assert.equal(r.dropped[0].reason, 'duplicate');
});

test('no more deals than the cap', () => {
  const r = checkPlan([step({ action: 'full_analysis', dealId: A }), step({ action: 'full_analysis', dealId: B })], ctx({ maxTargets: 1 }));
  assert.equal(r.steps.length, 1);
  assert.equal(r.dropped[0].reason, 'too_many');
});

test('links: the sites the server can check; Zoopla needs the extension; anything else is unsupported', () => {
  const r = checkPlan(
    [
      step({ action: 'check_link', url: 'https://www.rightmove.co.uk/properties/123456?channel=RES_BUY' }),
      step({ action: 'check_link', url: 'https://www.zoopla.co.uk/for-sale/details/987/' }),
      step({ action: 'check_link', url: 'https://www.spareroom.co.uk/flatshare/123' }),
      step({ action: 'check_link', url: 'https://www.rightmove.co.uk/properties/123456' }),
    ],
    ctx(),
  );
  assert.deepEqual(r.steps, [{ kind: 'check_link', url: 'https://www.rightmove.co.uk/properties/123456', source: 'rightmove' }]);
  assert.deepEqual(r.dropped.map((d) => d.reason), ['needs_extension', 'unsupported_site', 'duplicate']);
});

test('only a link the member pasted is checked, never one from elsewhere', () => {
  const r = checkPlan([step({ action: 'check_link', url: 'https://www.rightmove.co.uk/properties/777' })], ctx());
  assert.equal(r.dropped[0].reason, 'link_not_given');
  assert.equal(checkPlan([step({ action: 'check_link', url: 'https://www.rightmove.co.uk/properties/777' })], ctx({ question: 'check (https://www.rightmove.co.uk/properties/777).' })).steps.length, 1);
});

test('a Full analysis and a Deep report of one deal are one Deep report', () => {
  const r = checkPlan([step({ action: 'full_analysis', dealId: A }), step({ action: 'full_analysis', dealId: B }), step({ action: 'deep_report', dealId: A })], ctx());
  assert.deepEqual(r.steps.map((s) => [s.kind, 'dealId' in s ? s.dealId : null]), [['deep_report', A], ['full_analysis', B]]);
  assert.equal(r.dropped.length, 0);
  const back = checkPlan([step({ action: 'deep_report', dealId: A }), step({ action: 'full_analysis', dealId: A })], ctx());
  assert.deepEqual(back.steps.map((s) => s.kind), ['deep_report']);
  assert.equal(back.dropped[0].reason, 'duplicate');
});

test('a member without listing checks gets no link check', () => {
  const r = checkPlan([step({ action: 'check_link', url: 'https://www.rightmove.co.uk/properties/1' })], ctx({ linkChecks: false }));
  assert.equal(r.dropped[0].reason, 'no_link_checks');
});

test('one deep search, and only when it is on offer', () => {
  assert.equal(checkPlan([step({ action: 'deep_search' }), step({ action: 'deep_search' })], ctx()).steps.length, 1);
  assert.equal(checkPlan([step({ action: 'deep_search' })], ctx({ deepSearch: 'running' })).dropped[0].reason, 'deep_search_running');
  assert.equal(checkPlan([step({ action: 'deep_search' })], ctx({ deepSearch: 'off' })).dropped[0].reason, 'deep_search_off');
});

test('a deal type is removed only when the member asked in plain words', () => {
  const remove = step({ action: 'change_criteria', question: 'remove_deal_type', value: 'brrr' });
  assert.equal(checkPlan([remove], ctx({ question: 'only 2-beds under 180k' })).dropped[0].reason, 'not_asked_to_remove');
  assert.equal(checkPlan([remove], ctx({ question: 'Stop showing me BRRR deals' })).steps.length, 1);
  assert.equal(checkPlan([step({ action: 'change_criteria', question: 'add_deal_type', value: 'BRRR' })], ctx()).steps.length, 1);
});

test('criteria: an unknown question, an empty value or two changes to one question are refused', () => {
  const r = checkPlan(
    [
      step({ action: 'change_criteria', question: 'plan', value: 'cancel' }),
      step({ action: 'change_criteria', question: 'bedrooms', value: '' }),
      step({ action: 'change_criteria', question: 'bedrooms', value: '2' }),
      step({ action: 'change_criteria', question: 'bedrooms', value: '3' }),
      step({ action: 'change_criteria', question: 'add_areas', value: '123' }),
    ],
    ctx(),
  );
  assert.deepEqual(r.steps, [{ kind: 'change_criteria', question: 'bedrooms', value: '2' }]);
  assert.deepEqual(r.dropped.map((d) => d.reason), ['bad_value', 'bad_value', 'duplicate', 'bad_value']);
});

test('removal words and type names', () => {
  assert.equal(memberAskedToRemove("I don't want rent-to-rent any more", 'r2r'), true);
  assert.equal(memberAskedToRemove('show me more rent to rent', 'r2r'), false);
  assert.equal(memberAskedToRemove('remove brrr', 'buy_str'), false);
  assert.equal(memberAskedToRemove('Stop showing me BRRR deals', 'brrr'), true);
  assert.equal(memberAskedToRemove('No more short lets please', 'buy_str'), true);
  // Review: a removal word anywhere plus the type's name isn't asking to remove it.
  assert.equal(memberAskedToRemove("I don't want to lose short-lets, add BRRR", 'buy_str'), false);
  assert.equal(memberAskedToRemove('add BRRR without dropping short-lets', 'buy_str'), false);
  assert.equal(memberAskedToRemove("don't stop showing me BRRR", 'brrr'), false);
  assert.equal(memberAskedToRemove('remove the 3-beds from my search and show me more rent to rent', 'r2r'), false);
  assert.equal(dealTypeOf('Short-let'), 'buy_str');
  assert.equal(dealTypeOf('r2r'), 'r2r');
  // Batch 28: Buy to let is a type the eye can add or remove, by its names.
  assert.equal(dealTypeOf('btl'), 'btl');
  assert.equal(dealTypeOf('Buy to let'), 'btl');
  assert.equal(dealTypeOf('hmo'), null);
  assert.equal(memberAskedToRemove('stop showing me buy to let deals', 'btl'), true);
  assert.equal(memberAskedToRemove('add buy to let', 'btl'), false);
});

test('area codes: letters only, upper-cased, no repeats', () => {
  assert.deepEqual(areaCodes('bd, LS ls 12 B1'), ['BD', 'LS']);
});

test('Batch 28: a buy-to-let report runs only on a buy-to-let deal, once', () => {
  const c = ctx({ deals: new Map([[A, deal(A, { btl: true })], [B, deal(B)]]) });
  const r = checkPlan([step({ action: 'btl_report', dealId: A }), step({ action: 'btl_report', dealId: A }), step({ action: 'btl_report', dealId: B })], c);
  assert.deepEqual(r.steps, [{ kind: 'btl_report', dealId: A, label: '2-bed flat in LS6' }]);
  assert.deepEqual(r.dropped.map((d) => d.reason), ['duplicate', 'not_btl']);
});
