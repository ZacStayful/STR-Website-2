import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_TARGETS, NAV_ORDER, NAV_FOR_SECTION, activeNavFor, LEADS_NAV, MY_DEALS_PASSED_HREF, dealsViewRedirect, myDealsShowsPassed, type Section } from './nav.ts';
import { parseDealFilters } from './marketplace/grid.ts';

const SECTIONS: Section[] = ['today', 'estimate', 'markets', 'deals', 'picks', 'reports', 'leads', 'account'];

test('the nav has exactly three items, each with a label and an internal href', () => {
  assert.deepEqual(NAV_ORDER, ['today', 'myDeals', 'account']);
  for (const key of NAV_ORDER) {
    assert.ok(NAV_TARGETS[key].label.length > 0, key);
    assert.ok(NAV_TARGETS[key].href.startsWith('/'), key);
  }
  assert.ok(LEADS_NAV.href.startsWith('/'));
  assert.equal(NAV_TARGETS.today.href, '/today');
  assert.equal(NAV_TARGETS.myDeals.href, '/my-deals');
});

test('every section highlights one of the nav items (or Leads)', () => {
  for (const s of SECTIONS) {
    const active = activeNavFor(s);
    assert.ok(active === 'leads' || active in NAV_TARGETS, `${s} → ${active}`);
    assert.equal(active, NAV_FOR_SECTION[s]);
  }
  assert.equal(activeNavFor('today'), 'today');
  assert.equal(activeNavFor('deals'), 'today');
  assert.equal(activeNavFor('picks'), 'today');
  assert.equal(activeNavFor('reports'), 'myDeals');
  assert.equal(activeNavFor('account'), 'account');
  assert.equal(activeNavFor('leads'), 'leads');
});

test('old /deals?view= links go to My deals: kept to the list, passed to its Passed group', () => {
  assert.equal(dealsViewRedirect('kept'), '/my-deals');
  assert.equal(dealsViewRedirect('passed'), '/my-deals?show=passed');
  assert.equal(dealsViewRedirect('passed'), MY_DEALS_PASSED_HREF);
  for (const v of ['all', '', null, undefined, 'KEPT', 'Passed', 'everyone']) assert.equal(dealsViewRedirect(v), null, String(v));
  // Through the grid's own parser, which is what the page does.
  assert.equal(dealsViewRedirect(parseDealFilters({ view: ['passed', 'kept'] }).view), MY_DEALS_PASSED_HREF, 'the first value wins');
  assert.equal(dealsViewRedirect(parseDealFilters({ view: 'kept', kind: 'rent', page: '3' }).view), '/my-deals', 'filters are dropped');
  assert.equal(dealsViewRedirect(parseDealFilters({ view: 'drop table' }).view), null);
  assert.equal(dealsViewRedirect(parseDealFilters({}).view), null);
});

test('My deals opens its Passed group only for ?show=passed, and reads its own link back', () => {
  const show = new URL(MY_DEALS_PASSED_HREF, 'https://example.test').searchParams.get('show');
  assert.equal(myDealsShowsPassed(show), true);
  assert.equal(myDealsShowsPassed(['passed', 'x']), true);
  for (const v of [undefined, null, '', 'kept', 'Passed', ['x', 'passed']]) assert.equal(myDealsShowsPassed(v), false, JSON.stringify(v));
});
