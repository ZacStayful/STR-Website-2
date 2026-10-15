import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptableCallSid } from './adopt.ts';

const PLACED = Date.parse('2026-10-14T09:00:00Z');
const SID_A = 'CA' + 'a'.repeat(32);
const SID_B = 'CA' + 'b'.repeat(32);
const SID_C = 'CA' + 'c'.repeat(32);
const at = (offsetSecs: number) => new Date(PLACED + offsetSecs * 1000).toUTCString();

test('R3-25: the outbound call Twilio started just after the row was placed is adopted, newest first', () => {
  const json = {
    calls: [
      { sid: SID_C, direction: 'inbound', start_time: at(20), status: 'completed' },
      { sid: SID_A, direction: 'outbound-api', start_time: at(12), status: 'completed' },
      { sid: SID_B, direction: 'outbound-api', start_time: at(-3600), status: 'completed' },
    ],
  };
  assert.equal(adoptableCallSid(json, PLACED), SID_A);
});

test('nothing is adopted outside the window, from the wrong direction, or from a malformed list', () => {
  assert.equal(adoptableCallSid({ calls: [{ sid: SID_A, direction: 'outbound-api', start_time: at(10 * 60) }] }, PLACED), null);
  assert.equal(adoptableCallSid({ calls: [{ sid: SID_A, direction: 'outbound-api', start_time: at(-120) }] }, PLACED), null);
  assert.equal(adoptableCallSid({ calls: [{ sid: SID_A, direction: 'inbound', start_time: at(5) }] }, PLACED), null);
  assert.equal(adoptableCallSid({ calls: [{ sid: 'nope', direction: 'outbound-api', start_time: at(5) }] }, PLACED), null);
  assert.equal(adoptableCallSid({ calls: [{ sid: SID_A, direction: 'outbound-api', start_time: null, date_created: at(5) }] }, PLACED), SID_A);
  assert.equal(adoptableCallSid(null, PLACED), null);
  assert.equal(adoptableCallSid({ calls: 'x' }, PLACED), null);
});
