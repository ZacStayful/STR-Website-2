import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUnlocked } from './picks.ts';

const payer = (owners: Record<string, string>) => (id: string) => owners[id] ?? id;

test('a deal the member unlocked themselves is never their pick', () => {
  const had = new Map([['me', new Set(['sent-before'])]]);
  addUnlocked(had, ['me'], payer({}), new Map([['me', new Set(['deal-a'])]]));
  assert.deepEqual([...had.get('me')!].sort(), ['deal-a', 'sent-before']);
});

test('a deal the team owner unlocked is never a team member’s pick', () => {
  const had = new Map<string, Set<string>>();
  addUnlocked(had, ['member', 'owner'], payer({ member: 'owner' }), new Map([['owner', new Set(['deal-a'])]]));
  assert.deepEqual([...had.get('member')!], ['deal-a']);
  assert.deepEqual([...had.get('owner')!], ['deal-a']);
});

test('another account’s unlocks change nothing', () => {
  const had = new Map<string, Set<string>>();
  addUnlocked(had, ['me'], payer({}), new Map([['someone-else', new Set(['deal-a'])]]));
  assert.equal(had.has('me'), false);
});
