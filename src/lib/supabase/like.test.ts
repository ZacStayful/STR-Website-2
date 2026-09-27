import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactLike } from './like.ts';

/** ILIKE as Postgres reads the pattern (backslash escapes), for checking what a pattern would match. */
function ilikeMatches(pattern: string, value: string): boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === '%') re += '.*';
    else if (ch === '_') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'is').test(value);
}

test('an underscore in an email no longer matches another address', () => {
  assert.equal(ilikeMatches('jane_doe@gmail.com', 'jane.doe@gmail.com'), true); // the bug
  assert.equal(ilikeMatches(exactLike('jane_doe@gmail.com'), 'jane.doe@gmail.com'), false);
  assert.equal(ilikeMatches(exactLike('jane_doe@gmail.com'), 'jane_doe@gmail.com'), true);
});

test('case is still ignored', () => {
  assert.equal(ilikeMatches(exactLike('jane_doe@gmail.com'), 'Jane_Doe@Gmail.com'), true);
});

test('a percent sign or backslash matches only itself', () => {
  assert.equal(exactLike('a%b\\c_d'), 'a\\%b\\\\c\\_d');
  assert.equal(ilikeMatches(exactLike('%'), 'anyone@example.com'), false);
  assert.equal(ilikeMatches(exactLike('a%b'), 'a%b'), true);
  assert.equal(ilikeMatches(exactLike('a\\b'), 'a\\b'), true);
});

test('a plain email is unchanged', () => {
  assert.equal(exactLike('jane.doe@gmail.com'), 'jane.doe@gmail.com');
});
