import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callBoxNote, callPriceLine } from './choices.ts';

test('call prices come from settings', () => {
  const s = { siCallPencePerMin: 65, siTextPence: 22, siEmailPence: 20 };
  assert.match(callPriceLine(s), /About 65p a minute/);
  assert.match(callBoxNote(s), /about 65p a minute.*Texts 22p, emails 20p/);
  assert.match(callPriceLine({ ...s, siCallPencePerMin: 70 }), /About 70p a minute/);
});
