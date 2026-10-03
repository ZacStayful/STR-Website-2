import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeShare, parseCounts, percent, shareChange, tallyWeeks } from './coverage.ts';

const rows = parseCounts([
  { week: '2026-09-21', channel: 'call', outcome: 'answered', ref: 'credits', n: 6 },
  { week: '2026-09-21', channel: 'call', outcome: 'answered', ref: '[guide.credit]', n: 2 },
  { week: '2026-09-21', channel: 'call', outcome: 'answered', ref: 'not_approved_yet', n: 1 },
  { week: '2026-09-21', channel: 'call', outcome: 'answered', ref: null, n: 1 },
  { week: '2026-09-21', channel: 'call', outcome: 'could_not_answer', ref: null, n: 3 },
  { week: '2026-09-21', channel: 'call', outcome: 'member_unhappy', ref: null, n: 2 },
  { week: '2026-09-21', channel: 'sms', outcome: 'handed_off', ref: null, n: 1 },
  { week: '2026-09-21', channel: 'call', outcome: 'low_confidence', ref: null, n: 1 },
  { week: '2026-09-14', channel: 'call', outcome: 'answered', ref: 'credits', n: 1 },
  { week: '2026-09-14', channel: 'call', outcome: 'could_not_answer', ref: null, n: 1 },
  { week: '2026-08-01', channel: 'call', outcome: 'answered', ref: 'credits', n: 99 },
  { week: 'bad', channel: 'call', outcome: 'answered', ref: 'credits', n: 1 },
  { week: '2026-09-21', channel: 'call', outcome: 'answered', ref: 'credits', n: -1 },
  null,
]);

const approved = new Set(['credits', 'credit_how']);

test('malformed rows are dropped', () => {
  assert.equal(rows.length, 11);
  assert.deepEqual(parseCounts('nope'), []);
});

test('answered from approved knowledge, legacy refs mapped; member unhappy is not a question', () => {
  const [prior, last] = tallyWeeks(rows, ['2026-09-14', '2026-09-21'], approved);
  assert.equal(last.total.asked, 15);
  assert.equal(last.total.fromKnowledge, 8, 'credits (6) and guide.credit → credit_how (2)');
  assert.equal(last.total.answeredOther, 2);
  assert.equal(last.total.couldNotAnswer, 3);
  assert.equal(last.total.lowConfidence, 1);
  assert.equal(last.total.handedOff, 1);
  assert.equal(last.total.memberUnhappy, 2);
  assert.equal(last.byChannel.call.asked, 14);
  assert.equal(last.byChannel.sms.handedOff, 1);
  assert.equal(prior.total.asked, 2);
  assert.equal(percent(knowledgeShare(last.total)), '53%');
  assert.equal(shareChange(knowledgeShare(last.total), knowledgeShare(prior.total)), 'up 3 points');
});

test('weeks outside the list are ignored; an empty week has no share', () => {
  const [w] = tallyWeeks(rows, ['2026-09-28'], approved);
  assert.equal(w.total.asked, 0);
  assert.equal(knowledgeShare(w.total), null);
  assert.equal(percent(null), '—');
  assert.equal(shareChange(null, 0.5), null);
  assert.equal(shareChange(0.5, 0.5), 'no change');
  assert.equal(shareChange(0.49, 0.5), 'down 1 point');
});
