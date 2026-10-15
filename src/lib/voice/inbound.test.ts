import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboundIdentity } from './inbound.ts';

const SID = 'CA' + 'f'.repeat(32);

test('R3-17: a member is identified only with calls switched on, and never on a dry run', () => {
  assert.deepEqual(inboundIdentity({ userId: 'u1', callsOn: true, dryRun: false, callSid: SID }), { kind: 'member', userId: 'u1', callSid: SID });
  assert.deepEqual(inboundIdentity({ userId: 'u1', callsOn: false, dryRun: false, callSid: SID }), { kind: 'unknown', reason: 'no_consent' });
  assert.deepEqual(inboundIdentity({ userId: 'u1', callsOn: null, dryRun: false, callSid: SID }), { kind: 'unknown', reason: 'no_consent' });
  assert.deepEqual(inboundIdentity({ userId: 'u1', callsOn: true, dryRun: true, callSid: SID }), { kind: 'unknown', reason: 'dry_run' });
  assert.deepEqual(inboundIdentity({ userId: null, callsOn: null, dryRun: false, callSid: SID }), { kind: 'unknown', reason: 'no_member' });
});

test('R3-50: no member data for a call Twilio did not place (a forged or replayed POST with no real call sid)', () => {
  for (const sid of [null, undefined, '', 'replay', 'CA123', 'XA' + 'f'.repeat(32), 42]) {
    assert.deepEqual(inboundIdentity({ userId: 'u1', callsOn: true, dryRun: false, callSid: sid }), { kind: 'unknown', reason: 'no_call_sid' }, String(sid));
  }
  assert.equal(inboundIdentity({ userId: 'u1', callsOn: true, dryRun: false, callSid: SID.toLowerCase() }).kind, 'member');
});
