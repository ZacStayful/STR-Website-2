import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_TARGETS, NAV_ORDER, NAV_FOR_SECTION, activeNavFor, LEADS_NAV, type Section } from './nav.ts';

const SECTIONS: Section[] = ['estimate', 'markets', 'deals', 'picks', 'reports', 'leads', 'account'];

test('the nav has exactly three items, each with a label and an internal href', () => {
  assert.deepEqual(NAV_ORDER, ['today', 'myDeals', 'account']);
  for (const key of NAV_ORDER) {
    assert.ok(NAV_TARGETS[key].label.length > 0, key);
    assert.ok(NAV_TARGETS[key].href.startsWith('/'), key);
  }
  assert.ok(LEADS_NAV.href.startsWith('/'));
});

test('every section highlights one of the nav items (or Leads)', () => {
  for (const s of SECTIONS) {
    const active = activeNavFor(s);
    assert.ok(active === 'leads' || active in NAV_TARGETS, `${s} → ${active}`);
    assert.equal(active, NAV_FOR_SECTION[s]);
  }
  assert.equal(activeNavFor('deals'), 'today');
  assert.equal(activeNavFor('picks'), 'today');
  assert.equal(activeNavFor('reports'), 'myDeals');
  assert.equal(activeNavFor('account'), 'account');
  assert.equal(activeNavFor('leads'), 'leads');
});
