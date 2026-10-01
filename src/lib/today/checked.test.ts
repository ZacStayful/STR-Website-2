import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedLine, parseChoiceTally } from './checked.ts';

const t = (o = {}) => ({ checked: 43, meeting: null, capped: false, nearby: false, finds: 0, ...o });

test('untailored: areas and budget; small counts said plainly', () => {
  assert.equal(checkedLine(t(), { tailored: false, smallCount: 20 }), 'I checked 43 live deals in your areas and budget — this is the best fit.');
  assert.equal(checkedLine(t({ checked: 7 }), { tailored: false, smallCount: 20 }), 'I checked 7 live deals in your areas.');
  assert.equal(checkedLine(t({ nearby: true }), { tailored: false, smallCount: 20 }), 'I checked 43 live deals in your areas and budget, and nearby — this is the best fit.');
});

test('tailored: across the UK against the must-haves', () => {
  assert.equal(checkedLine(t({ checked: 150, meeting: 12 }), { tailored: true, smallCount: 20 }), 'I checked 150 live deals across the UK against your must-haves: 12 meet them.');
});

test('capped and finds; never "all" or "every"', () => {
  const line = checkedLine(t({ checked: 1000, capped: true, finds: 2 }), { tailored: false, smallCount: 20 }) ?? '';
  assert.match(line, /the 1,000 most profitable live deals/);
  assert.match(line, /including 2 I found for you just now/);
  assert.doesNotMatch(line, /\b(all|every)\b/);
  assert.equal(checkedLine(t({ checked: 0 }), { tailored: false, smallCount: 20 }), null);
});

test('parsing the stored column', () => {
  assert.deepEqual(parseChoiceTally({ checked: 5, meeting: 2, capped: true }), { checked: 5, meeting: 2, capped: true, nearby: false, finds: 0 });
  assert.equal(parseChoiceTally(null), null);
  assert.equal(parseChoiceTally({ checked: 'x' }), null);
});
