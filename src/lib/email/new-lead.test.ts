import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newLeadEmail, type NewLeadEmailInput } from './new-lead.ts';

const base: NewLeadEmailInput = {
  funnelName: 'Website form',
  landlordName: 'Jane Smith',
  landlordEmail: 'jane@example.com',
  landlordPhone: '07700 900123',
  area: 'M14',
  bedrooms: 3,
  annualIncome: 31250.4,
  qualified: true,
  leadUrl: 'https://example.test/leads/abc',
  pdfUrl: 'https://example.test/r/tok/pdf',
  settingsUrl: 'https://example.test/leads/funnels/f1',
};

test('the owner gets the landlord, the property, the headline and the verdict', () => {
  const e = newLeadEmail(base);
  assert.equal(e.subject, 'New lead: Jane Smith — 3-bedroom property in M14');
  for (const s of ['Jane Smith', 'jane@example.com', '07700 900123', '3-bedroom property in M14', '£31,250 a year', 'Meets your lead filter', 'https://example.test/leads/abc', 'https://example.test/r/tok/pdf']) {
    assert.ok(e.text.includes(s), s);
    assert.ok(e.html.includes(s.replace(/&/g, '&amp;')), s);
  }
  assert.match(e.text, /Stayful Intelligence/);
});

test('the area, never the full address', () => {
  const e = newLeadEmail(base);
  assert.doesNotMatch(e.text, /Street|Road/);
});

test('unqualified and missing details read plainly', () => {
  const e = newLeadEmail({ ...base, landlordName: null, landlordPhone: null, area: null, bedrooms: null, annualIncome: 0, qualified: false, pdfUrl: null });
  assert.equal(e.subject, 'New lead: A landlord — Property');
  assert.match(e.text, /Does not meet your lead filter/);
  assert.doesNotMatch(e.text, /Phone:/);
  assert.doesNotMatch(e.text, /PDF/);
});

test('what a landlord typed is escaped, and cannot break the subject line', () => {
  const e = newLeadEmail({ ...base, landlordName: '<script>x</script>\r\nBcc: a@b.c' });
  assert.ok(!e.html.includes('<script>'));
  assert.ok(!/[\r\n]/.test(e.subject));
});
