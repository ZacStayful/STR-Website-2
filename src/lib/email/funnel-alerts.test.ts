import { test } from 'node:test';
import assert from 'node:assert/strict';
import { funnelAlertEmail, type FunnelAlertKind } from './funnel-alerts.ts';

const KINDS: FunnelAlertKind[] = ['out_of_credit', 'paused_hit', 'daily_cap', 'spend_cap'];

test('every wall produces a usable email naming the funnel', () => {
  for (const kind of KINDS) {
    const email = funnelAlertEmail({ kind, funnelName: 'Website enquiries', funnelId: 'abc-123' });
    assert.ok(email.subject.length > 0, `${kind} has no subject`);
    // Which funnel: an owner with several needs to know which one stopped.
    assert.match(email.subject + email.text, /Website enquiries/, `${kind} does not name the funnel`);
    // And one thing to do about it.
    assert.match(email.text, /https?:\/\//, `${kind} carries no link`);
    assert.match(email.html, /<a href="https?:\/\//, `${kind} html carries no link`);
  }
});

test('an unnamed funnel still reads as a sentence', () => {
  const email = funnelAlertEmail({ kind: 'daily_cap', funnelName: '   ', funnelId: 'abc' });
  assert.match(email.subject, /^Your funnel/);
});

test('a customer-supplied funnel name cannot inject markup', () => {
  // The name is the customer's own text and goes into an HTML email.
  const email = funnelAlertEmail({
    kind: 'out_of_credit',
    funnelName: '<script>alert(1)</script>',
    funnelId: 'abc',
  });
  assert.ok(!email.html.includes('<script>'), 'raw script tag reached the html');
  assert.match(email.html, /&lt;script&gt;/);
});

test('the funnel id is escaped into the link rather than concatenated raw', () => {
  const email = funnelAlertEmail({ kind: 'spend_cap', funnelName: 'F', funnelId: 'a b/c' });
  assert.ok(!email.text.includes('a b/c'), 'unescaped id reached the link');
  assert.match(email.text, /a%20b%2Fc/);
});

test('credit sends the owner to billing and the caps send them to the funnel', () => {
  const credit = funnelAlertEmail({ kind: 'out_of_credit', funnelName: 'F', funnelId: 'abc' });
  assert.match(credit.text, /\/account\/billing/);
  for (const kind of ['daily_cap', 'spend_cap', 'paused_hit'] as FunnelAlertKind[]) {
    assert.match(funnelAlertEmail({ kind, funnelName: 'F', funnelId: 'abc' }).text, /\/leads\/funnels\/abc/);
  }
});
