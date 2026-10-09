import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildButton, buildButtons, type ActionContext } from './actions.ts';

const deal = '0b6a3c3e-1111-4222-8333-444455556666';
const other = '9b6a3c3e-1111-4222-8333-444455556666';
const ctx = (o: Partial<ActionContext> = {}): ActionContext => ({ surface: 'full', teamMember: false, allowedDeals: new Set([deal]), allowedWhatIfs: new Set(['areas']), allowedShowMe: new Set([deal]), deepSearchOffered: false, ...o });

test('deal buttons only for deals the member was shown', () => {
  assert.deepEqual(buildButton('open_deal', deal, ctx()), { kind: 'open_deal', label: 'Open deal', href: `/deals/${deal}`, whatIfKey: null });
  assert.equal(buildButton('open_deal', other, ctx()), null);
  assert.equal(buildButton('open_deal', 'https://evil.example', ctx()), null);
  assert.equal(buildButton('full_analysis', deal, ctx())?.href, `/deals/${deal}?analysis=1`);
});

test('the quick box never offers a deal', () => {
  assert.equal(buildButton('open_deal', deal, ctx({ surface: 'quick' })), null);
  assert.equal(buildButton('top_up', null, ctx({ surface: 'quick' }))?.href, '/account/billing#topup');
});

test('Use this only for a what-if this answer offered; it performs nothing itself', () => {
  assert.deepEqual(buildButton('use_this', 'areas', ctx()), { kind: 'use_this', label: 'Use this', href: null, whatIfKey: 'areas' });
  assert.equal(buildButton('use_this', 'miles', ctx()), null);
  assert.equal(buildButton('use_this', 'drop_table', ctx()), null);
});

test('a team member is never offered a top-up', () => {
  assert.equal(buildButton('top_up', null, ctx({ teamMember: true })), null);
  assert.equal(buildButton('auto_topup', null, ctx({ teamMember: true })), null);
  assert.equal(buildButton('auto_topup', null, ctx())?.href, '/account/billing#auto-topup');
});

test('unknown kinds are dropped, repeats removed, at most three', () => {
  const b = buildButtons([{ kind: 'delete_account' }, { kind: 'open_deal', target: deal }, { kind: 'open_deal', target: deal }, { kind: 'open_today' }, { kind: 'notifications' }, { kind: 'top_up' }], ctx());
  assert.deepEqual(b.map((x) => x.kind), ['open_deal', 'open_today', 'notifications']);
});

test('the deep report only while the offer stands', () => {
  assert.equal(buildButton('deep_search', null, ctx()), null);
  assert.equal(buildButton('deep_search', null, ctx({ deepSearchOffered: true }))?.href, '/intelligence#si-deep-search');
});
