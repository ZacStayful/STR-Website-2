import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideResume, parseResumeItems, resumeReturnPath } from './resume-rules.ts';

const now = new Date('2026-10-01T12:00:00Z');
const items = [{ dealId: 'd1', withPmi: false, quotedBasePence: 250, quotedFacePence: 325 }];
const rq = (o = {}) => ({ dealId: 'd1', withPmi: false, basePence: 250, facePence: 325, affordable: true, available: true, ...o });
const decide = (requotes: ReturnType<typeof rq>[], o = {}) => decideResume({ status: 'open', expiresAt: '2026-10-01T12:30:00Z', now, items, requotes, ...o });

test('starts only when every price still matches', () => {
  assert.equal(decide([rq()]).kind, 'start');
});

test('a changed face price asks to confirm the new total', () => {
  const d = decide([rq({ facePence: 300 })]);
  assert.equal(d.kind, 'confirm');
  if (d.kind === 'confirm') assert.equal(d.totalFacePence, 300);
});

test('still short, gone, expired, used', () => {
  assert.equal(decide([rq({ affordable: false })]).kind, 'short');
  assert.equal(decide([rq({ available: false })]).kind, 'nothing');
  assert.equal(decide([rq()], { now: new Date('2026-10-01T12:31:00Z') }).kind, 'expired');
  assert.equal(decide([rq()], { status: 'done' }).kind, 'expired');
});

test('parsing and return paths', () => {
  assert.equal(parseResumeItems([{ dealId: 'x', quotedBasePence: 1, quotedFacePence: 1 }, { nope: 1 }, 'bad']).length, 1);
  assert.equal(parseResumeItems('x').length, 0);
  assert.equal(resumeReturnPath('/welcome/reveal'), '/welcome/reveal');
  assert.equal(resumeReturnPath('https://evil.example/'), '/today');
  assert.equal(resumeReturnPath('//evil.example'), '/today');
});
