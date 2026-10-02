import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isManagementTouch, managementOnly, MC_PATH, shellGate } from './stamp.ts';
import { chooseTouch, parseTouch, serializeTouch, touchFromPage, type Touch } from '../tracking/touch.ts';

const now = Date.parse('2026-10-02T09:00:00Z');

function landed(href: string): Touch {
  const t = touchFromPage(href, 'https://l.facebook.com/', now);
  assert.ok(t, href);
  return t;
}

test('a first touch on the management page is a management company', () => {
  assert.equal(isManagementTouch(landed(`https://stayful.co.uk${MC_PATH}?utm_source=facebook&fbclid=abc`)), true);
  assert.equal(isManagementTouch(landed(`https://stayful.co.uk${MC_PATH}`)), true);
  assert.equal(isManagementTouch(landed('https://stayful.co.uk/?utm_source=facebook')), false);
  assert.equal(isManagementTouch(landed('https://stayful.co.uk/pricing')), false);
  assert.equal(isManagementTouch(null), false);
});

test('the stamp survives the hidden sign-up field (no cookie: consent not given)', () => {
  const carried = serializeTouch(landed(`https://stayful.co.uk${MC_PATH}?fbclid=xyz`));
  const { touch, via } = chooseTouch(null, parseTouch(carried), 'form');
  assert.equal(via, 'form');
  assert.equal(isManagementTouch(touch), true);
});

test("the stamp survives Google's return (attr on the callback address)", () => {
  const carried = serializeTouch(landed(`https://stayful.co.uk${MC_PATH}?utm_campaign=mc`));
  const back = new URL(`https://stayful.co.uk/auth/callback?next=%2Fleads%2Fsetup&attr=${encodeURIComponent(carried)}`);
  const { touch, via } = chooseTouch(null, parseTouch(back.searchParams.get('attr')), 'redirect');
  assert.equal(via, 'redirect');
  assert.equal(isManagementTouch(touch), true);
});

test('an older first touch kept in the cookie wins: that account is not stamped by the touch', () => {
  const cookie = landed('https://stayful.co.uk/?utm_source=google');
  const carried = landed(`https://stayful.co.uk${MC_PATH}?fbclid=1`);
  assert.equal(isManagementTouch(chooseTouch(cookie, carried, 'form').touch), false);
});

test('a stamped member is never sent to the quiz or the reveal until deal-finding is on', () => {
  const stamped = { signupPath: 'management', teamMember: false };
  assert.equal(shellGate({ ...stamped, mandatoryDone: false, revealPending: false }), 'none');
  assert.equal(shellGate({ ...stamped, mandatoryDone: false, revealPending: true }), 'none');
  // Deal-finding switched on from the Profile pill: the one-off reveal, as for everyone.
  assert.equal(shellGate({ ...stamped, mandatoryDone: true, revealPending: true }), 'reveal');
  assert.equal(shellGate({ ...stamped, mandatoryDone: true, revealPending: false }), 'none');
});

test('everyone else meets the gates exactly as before', () => {
  const member = { signupPath: null, teamMember: false };
  assert.equal(shellGate({ ...member, mandatoryDone: false, revealPending: false }), 'quiz');
  assert.equal(shellGate({ ...member, mandatoryDone: true, revealPending: true }), 'reveal');
  assert.equal(shellGate({ ...member, mandatoryDone: true, revealPending: false }), 'none');
  assert.equal(shellGate({ signupPath: null, teamMember: true, mandatoryDone: false, revealPending: true }), 'none');
});

test('management-only means stamped without deal-finding', () => {
  assert.equal(managementOnly({ signupPath: 'management', mandatoryDone: false }), true);
  assert.equal(managementOnly({ signupPath: 'management', mandatoryDone: true }), false);
  assert.equal(managementOnly({ signupPath: null, mandatoryDone: false }), false);
  assert.equal(managementOnly({ signupPath: 'investor', mandatoryDone: false }), false);
});
