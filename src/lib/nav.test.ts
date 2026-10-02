import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_TARGETS, NAV_ORDER, NAV_FOR_SECTION, activeNavFor, LEADS_NAV, MY_DEALS_PASSED_HREF, dealsViewRedirect, myDealsShowsPassed, GOALS_EDITOR_HREF, PROFILE_QUIZ_HREF, TODAY_LIST_ID, TODAY_LIST_HREF, samePageAnchor, joinLandingPath, ACCOUNT_MORE, accountMoreLinks, EYE_NAV, NAV_DESTINATIONS, type Section } from './nav.ts';
import { parseDealFilters } from './marketplace/grid.ts';

const SECTIONS: Section[] = ['home', 'today', 'estimate', 'markets', 'deals', 'picks', 'reports', 'leads', 'account', 'profile'];

test('the nav (Batch 22e, decided by Zac): Home, Today, My deals, Browse, Market Explorer, Analyser, Account', () => {
  assert.deepEqual(NAV_ORDER, ['home', 'today', 'myDeals', 'browse', 'markets', 'analyser', 'account']);
  assert.deepEqual(
    NAV_ORDER.map((k) => NAV_TARGETS[k].label),
    ['Home', 'Today', 'My deals', 'Browse', 'Market Explorer', 'Analyser', 'Account'],
  );
  assert.equal(NAV_TARGETS.home.href, '/home');
  for (const key of NAV_ORDER) {
    assert.ok(NAV_TARGETS[key].label.length > 0, key);
    assert.ok(NAV_TARGETS[key].href.startsWith('/'), key);
  }
  assert.ok(LEADS_NAV.href.startsWith('/'));
  assert.equal(NAV_TARGETS.today.href, '/today');
  assert.equal(NAV_TARGETS.myDeals.href, '/my-deals');
  assert.equal(NAV_TARGETS.browse.href, '/deals');
  assert.equal(NAV_TARGETS.markets.href, '/markets');
  assert.equal(NAV_TARGETS.analyser.href, '/estimate');
});

test('every section highlights one of the nav items (or Leads)', () => {
  for (const s of SECTIONS) {
    const active = activeNavFor(s);
    assert.ok(active === 'leads' || active in NAV_TARGETS, `${s} → ${active}`);
    assert.equal(active, NAV_FOR_SECTION[s]);
  }
  assert.equal(activeNavFor('today'), 'today');
  assert.equal(activeNavFor('deals'), 'browse');
  assert.equal(activeNavFor('markets'), 'markets');
  assert.equal(activeNavFor('estimate'), 'analyser');
  assert.equal(activeNavFor('picks'), 'today');
  assert.equal(activeNavFor('reports'), 'myDeals');
  assert.equal(activeNavFor('account'), 'account');
  assert.equal(activeNavFor('leads'), 'leads');
  assert.equal(activeNavFor('profile'), 'account', 'the profile page is a shortcut under Account, not a nav item');
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

test('the goals editor and Today’s list are internal links, the list one on Today itself', () => {
  assert.ok(GOALS_EDITOR_HREF.startsWith('/'));
  assert.equal(GOALS_EDITOR_HREF, '/profile', 'Batch 12: the profile page is the goals editor');
  assert.equal(PROFILE_QUIZ_HREF, '/welcome');
  assert.equal(TODAY_LIST_HREF, '/today#today-list');
  assert.match(TODAY_LIST_ID, /^[a-z][a-z-]*$/, 'a plain id, usable as an element id and a fragment');
});

test('a link is followed in place only when it stays on this page', () => {
  assert.equal(samePageAnchor(TODAY_LIST_HREF, '/today'), TODAY_LIST_ID);
  assert.equal(samePageAnchor('/today#today-list', '/my-deals'), null, 'from another page it is a navigation');
  assert.equal(samePageAnchor('#today-list', '/anywhere'), 'today-list', 'a bare fragment is always this page');
  assert.equal(samePageAnchor('/today?x=1#y', '/today'), 'y');
  assert.equal(samePageAnchor('/today#', '/today'), null, 'no id');
  assert.equal(samePageAnchor('/today', '/today'), null, 'no fragment');
  assert.equal(samePageAnchor('/my-deals', '/today'), null);
  assert.equal(samePageAnchor(GOALS_EDITOR_HREF, '/today'), null);
});

test('joining a team lands on its Leads only when it has a funnel', () => {
  assert.equal(joinLandingPath(true), LEADS_NAV.href);
  assert.equal(joinLandingPath(false), NAV_TARGETS.home.href);
});

test('Account › More: Team for account owners only, Leads only for a team with a funnel', () => {
  assert.deepEqual(accountMoreLinks({ teamMember: false, teamOwnsFunnel: false }), ['team', 'extension', 'markets', 'picks', 'feedback', 'calls']);
  assert.deepEqual(accountMoreLinks({ teamMember: false, teamOwnsFunnel: true }), ['team', 'leads', 'extension', 'markets', 'picks', 'feedback', 'calls']);
  assert.deepEqual(accountMoreLinks({ teamMember: true, teamOwnsFunnel: true }), ['leads', 'extension', 'markets', 'picks', 'feedback']);
  assert.deepEqual(accountMoreLinks({ teamMember: true, teamOwnsFunnel: false }), ['extension', 'markets', 'picks', 'feedback']);
  assert.equal(ACCOUNT_MORE.feedback.href, '/account/feedback', 'Batch 18: everyone, team members included, can see what they have sent');
  assert.equal(ACCOUNT_MORE.leads.href, LEADS_NAV.href, 'the same door as the nav');
  for (const [key, link] of Object.entries(ACCOUNT_MORE)) {
    assert.ok(link.href.startsWith('/') && !link.href.startsWith('//'), `${key} is internal`);
    assert.notEqual(link.href, '/reports', 'reports are a tab on My deals, not an Account door');
  }
});

test('the eye item: Talk to Stayful Intelligence, "Talk" on a phone, opening /intelligence', () => {
  assert.equal(EYE_NAV.label, 'Talk to Stayful Intelligence');
  assert.equal(EYE_NAV.shortLabel, 'Talk');
  assert.equal(EYE_NAV.href, '/intelligence');
});

test('no header label says Jarvis or plain Markets', () => {
  const labels = [EYE_NAV.label, EYE_NAV.shortLabel, LEADS_NAV.label, ...NAV_ORDER.map((k) => NAV_TARGETS[k].label)];
  for (const l of labels) {
    assert.ok(!/jarvis/i.test(l), l);
    assert.notEqual(l, 'Markets');
  }
  assert.equal(activeNavFor('home'), 'home');
});

test('destinations for "take me there" are internal paths with encoded ids', () => {
  assert.equal(NAV_DESTINATIONS.home(), '/home');
  assert.equal(NAV_DESTINATIONS.today(), '/today');
  assert.equal(NAV_DESTINATIONS.marketArea(' LS '), '/markets/ls');
  assert.equal(NAV_DESTINATIONS.deal('abc-123'), '/deals/abc-123');
  assert.equal(NAV_DESTINATIONS.deal('../admin'), '/deals/..%2Fadmin');
  assert.equal(NAV_DESTINATIONS.myDealsStage('viewing'), '/my-deals#stage-viewing');
  assert.equal(NAV_DESTINATIONS.myDealsStage('offer', 'p1'), '/my-deals?profile=p1#stage-offer');
  assert.equal(NAV_DESTINATIONS.analyser(), '/estimate');
});
