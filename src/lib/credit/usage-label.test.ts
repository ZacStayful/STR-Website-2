import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageDescription, actionLabel, tidyFunnelName, funnelIdFromMeta, memberIdFromMeta, withMemberName } from './usage-label.ts';

test('a member charge keeps the wording it always had', () => {
  // The regression that matters: every existing charge flows through here.
  assert.equal(usageDescription({ action: 'report', isFunnel: false }), 'Property report');
  assert.equal(usageDescription({ action: 'report_enhanced', isFunnel: false }), 'Enhanced property report (with PMI second opinion)');
  assert.equal(usageDescription({ action: 'quick_view', isFunnel: false }), 'Listing check (quick view)');
});

test('a funnel charge is named for what it is, not for the action', () => {
  // "Property report" is the exact word that makes a lead indistinguishable
  // from the member's own research.
  const d = usageDescription({ action: 'report', isFunnel: true, funnelName: 'Website enquiry form' });
  assert.equal(d, 'Funnel lead — Website enquiry form');
  assert.doesNotMatch(d, /Property report/);
});

test('the report depth is dropped from the funnel wording', () => {
  // It is the funnel's setting, not a per-lead choice, so it lengthens the
  // row without telling the customer anything they can act on.
  assert.equal(
    usageDescription({ action: 'report_enhanced', isFunnel: true, funnelName: 'Website form' }),
    'Funnel lead — Website form',
  );
});

test('a deleted funnel still reads as a lead', () => {
  // Losing the name is cosmetic; calling a lead the member's own research
  // is a wrong answer.
  for (const name of [null, undefined, '', '   ']) {
    assert.equal(usageDescription({ action: 'report', isFunnel: true, funnelName: name }), 'Funnel lead');
  }
});

test('an address lookup billed to a funnel is a lookup, not a lead', () => {
  // The prospect typed into the box and may never have submitted.
  assert.equal(
    usageDescription({ action: 'autocomplete', isFunnel: true, funnelName: 'Website form' }),
    'Funnel address lookup — Website form',
  );
});

test('an unknown action falls through to itself rather than to nothing', () => {
  assert.equal(actionLabel('some_new_action'), 'some_new_action');
  assert.equal(actionLabel(null), 'Usage');
  assert.equal(usageDescription({ action: 'some_new_action', isFunnel: false }), 'some_new_action');
});

test('a long funnel name is cut rather than breaking the row', () => {
  const long = 'A very long funnel name that somebody typed in without thinking about the billing page';
  const d = usageDescription({ action: 'report', isFunnel: true, funnelName: long });
  assert.ok(d.length < 60, `too long: ${d}`);
  assert.ok(d.endsWith('…'));
  assert.ok(d.startsWith('Funnel lead — A very long funnel name'));
});

test('a multi-line or padded name collapses to one line', () => {
  assert.equal(tidyFunnelName('  Website\n\n  enquiry   form '), 'Website enquiry form');
});

test('the name is not escaped here — React does that on render', () => {
  // Escaping twice is how a customer ends up seeing their own ampersand as
  // &amp; in their billing history.
  assert.equal(tidyFunnelName('Smith & Jones'), 'Smith & Jones');
  assert.equal(
    usageDescription({ action: 'report', isFunnel: true, funnelName: 'Smith & Jones' }),
    'Funnel lead — Smith & Jones',
  );
});

test('a funnel id is read off the metadata defensively', () => {
  assert.equal(funnelIdFromMeta({ funnel_id: 'abc' }), 'abc');
  assert.equal(funnelIdFromMeta({ funnel_id: '' }), null);
  assert.equal(funnelIdFromMeta({ funnel_id: 42 }), null);
  assert.equal(funnelIdFromMeta({}), null);
  assert.equal(funnelIdFromMeta(null), null);
  assert.equal(funnelIdFromMeta(undefined), null);
});

test('a team member’s spend is named on the owner’s usage history', () => {
  assert.equal(memberIdFromMeta({ member_id: 'abc' }), 'abc');
  assert.equal(memberIdFromMeta({ member_id: '' }), null);
  assert.equal(memberIdFromMeta(null), null);
  assert.equal(withMemberName('Property report', 'Sam'), 'Property report — by Sam');
  assert.equal(withMemberName('Property report', null), 'Property report');
});

test('a team seat has a label', () => {
  assert.equal(actionLabel('team_seat'), 'Team seat');
});
