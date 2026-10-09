import { test } from 'node:test';
import assert from 'node:assert/strict';
import { belowFloorChannels, better, callFloorPence, cannotCall, planMember, syncFromCall, type NotifyPlanInput } from './notify.ts';

const NOW = new Date('2026-10-05T11:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const member = { isOwner: true, callsOn: true, numberOk: true, managementOnly: false, balancePence: 2_000 };
const cand = (id: string, matchPct: number, profitLow: number, o: Partial<NotifyPlanInput['candidates'][number]> = {}) => ({ decisionId: id, matchPct, profitLow, savedAt: hoursAgo(1), dealLive: true, ...o });
const input = (o: Partial<NotifyPlanInput> = {}): NotifyPlanInput => ({
  candidates: [cand('a', 100, 1_300)],
  callsSwitchedOn: true,
  member,
  placedThisMonth: 0,
  callsPerMonth: 2,
  floorPence: 109,
  queued: null,
  textWindow: true,
  now: NOW,
  maxAgeMs: 3 * 86_400_000,
  ...o,
});

test('a standout for a member who can be called is a deal call', () => {
  assert.deepEqual(planMember(input()), [{ decisionId: 'a', action: 'call' }]);
});

test('several standouts at once: one call about the best (match, then profit); the rest go in "Saved for you"', () => {
  const steps = planMember(input({ candidates: [cand('a', 90, 2_000), cand('b', 100, 1_200), cand('c', 100, 1_500)] }));
  assert.deepEqual(steps.find((s) => s.action === 'call'), { decisionId: 'c', action: 'call' });
  assert.deepEqual(steps.filter((s) => s.action === 'email').map((s) => s.decisionId).sort(), ['a', 'b']);
});

test('a 3rd deal call in a calendar month never happens: saved, told in "Saved for you"', () => {
  assert.deepEqual(planMember(input({ placedThisMonth: 2 })), [{ decisionId: 'a', action: 'email', status: 'monthly_limit' }]);
  assert.deepEqual(planMember(input({ placedThisMonth: 1 })), [{ decisionId: 'a', action: 'call' }]);
});

test('members who can\'t be called are saved and told in "Saved for you"', () => {
  assert.deepEqual(planMember(input({ callsSwitchedOn: false })), [{ decisionId: 'a', action: 'email', status: 'deal_calls_off' }]);
  assert.deepEqual(planMember(input({ member: { ...member, callsOn: false } })), [{ decisionId: 'a', action: 'email', status: 'calls_off' }]);
  assert.deepEqual(planMember(input({ member: { ...member, isOwner: false } })), [{ decisionId: 'a', action: 'email', status: 'not_owner' }]);
  assert.deepEqual(planMember(input({ member: { ...member, numberOk: false } })), [{ decisionId: 'a', action: 'email', status: 'no_number' }]);
  assert.deepEqual(planMember(input({ member: { ...member, managementOnly: true } })), [{ decisionId: 'a', action: 'email', status: 'management_only' }]);
  assert.deepEqual(planMember(input({ member: null })), [{ decisionId: 'a', action: 'email', status: 'calls_off' }]);
});

test('credit below the floor: no call; the text and email go inside the text window, else wait', () => {
  assert.deepEqual(planMember(input({ member: { ...member, balancePence: 108 } })), [{ decisionId: 'a', action: 'below_floor' }]);
  assert.deepEqual(planMember(input({ member: { ...member, balancePence: 108 }, textWindow: false })), [{ decisionId: 'a', action: 'wait', status: 'waiting_window' }]);
  assert.deepEqual(planMember(input({ member: { ...member, balancePence: 109 } })), [{ decisionId: 'a', action: 'call' }]);
});

test('a deal call already waiting: a better standout takes it over, else "Saved for you"', () => {
  const queued = { callId: 'call-1', decisionId: 'old', matchPct: 100, profitLow: 1_200 };
  assert.deepEqual(planMember(input({ queued, candidates: [cand('a', 100, 1_300)] })), [{ decisionId: 'a', action: 'retarget', callId: 'call-1', replaces: 'old' }]);
  assert.deepEqual(planMember(input({ queued, candidates: [cand('a', 100, 1_100)] })), [{ decisionId: 'a', action: 'email', status: 'one_call' }]);
});

test('a deal that has gone is told nothing; a save too old to ring about goes in "Saved for you"', () => {
  assert.deepEqual(planMember(input({ candidates: [cand('a', 100, 1_300, { dealLive: false })] })), [{ decisionId: 'a', action: 'none', status: 'deal_gone' }]);
  assert.deepEqual(planMember(input({ candidates: [cand('a', 100, 1_300, { savedAt: hoursAgo(80) })] })), [{ decisionId: 'a', action: 'email', status: 'stale' }]);
});

test('below the floor, the text goes only with texts on and credit for both; else the email, charged if it can be, free if not', () => {
  const p = { textPence: 22, emailPence: 20 };
  assert.deepEqual(belowFloorChannels({ textsOn: true, balancePence: 42, ...p }), { text: true, chargeEmail: true });
  assert.deepEqual(belowFloorChannels({ textsOn: true, balancePence: 41, ...p }), { text: false, chargeEmail: false });
  assert.deepEqual(belowFloorChannels({ textsOn: false, balancePence: 20, ...p }), { text: false, chargeEmail: true });
  assert.deepEqual(belowFloorChannels({ textsOn: false, balancePence: 19, ...p }), { text: false, chargeEmail: false });
});

test('the call floor is the higher of the setting and Batch 23\'s own check', () => {
  assert.equal(callFloorPence(100, 65, 44), 109);
  assert.equal(callFloorPence(150, 65, 44), 150);
  assert.equal(callFloorPence(100, 64.5, 44), 109);
});

test('better: match first, then profit', () => {
  assert.ok(better({ matchPct: 100, profitLow: 1_000 }, { matchPct: 90, profitLow: 5_000 }));
  assert.ok(better({ matchPct: 100, profitLow: 1_300 }, { matchPct: 100, profitLow: 1_200 }));
  assert.ok(!better({ matchPct: 100, profitLow: 1_200 }, { matchPct: 100, profitLow: 1_200 }));
});

test('cannotCall: the switch first, then the member', () => {
  assert.equal(cannotCall(true, member), null);
  assert.equal(cannotCall(false, member), 'deal_calls_off');
});

test('a deal call\'s progress onto its decision; a call stopped before it rang is planned again unless the deal went or they acted', () => {
  assert.equal(syncFromCall({ status: 'queued', blocked_reason: null }), null);
  assert.deepEqual(syncFromCall({ status: 'answered', blocked_reason: null }), { callStatus: 'answered', notify: 'call', activity: 'si_deal_call' });
  assert.deepEqual(syncFromCall({ status: 'voicemail', blocked_reason: null }), { callStatus: 'voicemail', notify: 'call', activity: 'si_deal_call_missed' });
  assert.deepEqual(syncFromCall({ status: 'blocked', blocked_reason: 'deal_gone' }), { callStatus: 'deal_gone', notify: 'none' });
  assert.deepEqual(syncFromCall({ status: 'blocked', blocked_reason: 'deal_acted' }), { callStatus: 'deal_acted', notify: 'none' });
  assert.deepEqual(syncFromCall({ status: 'blocked', blocked_reason: 'monthly_limit' }), { callStatus: 'blocked:monthly_limit', notify: null });
  assert.deepEqual(syncFromCall({ status: 'failed', blocked_reason: null }), { callStatus: 'failed', notify: null });
  assert.deepEqual(syncFromCall(null), { callStatus: 'error', notify: null });
});
