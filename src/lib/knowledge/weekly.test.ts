import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTally } from './coverage.ts';
import { weekLabel, weeklyGapEmail } from './weekly.ts';

const base = {
  week: '2026-09-21',
  newGaps: 3,
  waitingDrafts: 2,
  gapsUrl: 'https://example.test/admin/intelligence/gaps',
  coverageUrl: 'https://example.test/admin/intelligence/coverage',
};

test('week labels', () => {
  assert.equal(weekLabel('2026-09-21'), '21–27 September 2026');
  assert.equal(weekLabel('2026-09-28'), '28 September – 4 October 2026');
});

test('coverage against the week before, the top gaps, the link', () => {
  const mail = weeklyGapEmail({
    ...base,
    topGaps: [{ label: 'Can I pause my plan?', asked: 4, status: 'drafted' }],
    lastWeek: { ...emptyTally(), asked: 10, fromKnowledge: 6 },
    weekBefore: { ...emptyTally(), asked: 10, fromKnowledge: 5 },
  });
  assert.equal(mail.subject, 'Stayful Intelligence gaps: week of 21–27 September 2026');
  assert.match(mail.text, /Answered from approved knowledge: 60% of 10 questions \(up 10 points on the week before, 50%\)\./);
  assert.match(mail.text, /New gaps: 3\. Drafts waiting for your approval: 2\./);
  assert.match(mail.text, /1\. Can I pause my plan\? \(asked 4 times; draft waiting for you\)/);
  assert.ok(mail.html.includes(base.gapsUrl));
});

test('a label is escaped and redacted, and never in the subject', () => {
  const mail = weeklyGapEmail({ ...base, topGaps: [{ label: '<script>x</script> call me on 07700 900123', asked: 1, status: 'open' }], lastWeek: emptyTally(), weekBefore: null });
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(mail.html.includes('&lt;script&gt;'));
  assert.ok(!mail.text.includes('07700'));
  assert.ok(!mail.subject.includes('script'));
  assert.match(mail.text, /No questions were logged last week\./);
});
