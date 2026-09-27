import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_KINDS, COUNTED_KINDS, QUALIFYING_KINDS, isActivityKind, isCounted, isQualifying, kindLabel } from './kinds.ts';

test('every kind has a label and a lower-case name', () => {
  for (const [kind, info] of Object.entries(ACTIVITY_KINDS)) {
    assert.match(kind, /^[a-z][a-z0-9_]*$/);
    assert.ok(info.label.length > 0, kind);
  }
});

test('the actions named in the brief count towards weekly active', () => {
  for (const k of ['today_view', 'keep', 'pass', 'pass_reasons', 'deal_open', 'deal_view', 'report_run', 'stage_move', 'next_step', 'deal_share', 'goals_saved', 'welcome_completed', 'notification_settings', 'topup', 'plan_start', 'plan_change', 'plan_cancel']) {
    assert.equal(isQualifying(k), true, k);
    assert.equal(isCounted(k), true, k);
  }
});

test('clicks, email-page answers, derived and automatic events are recorded but never qualify', () => {
  for (const k of ['email_click', 'sms_click', 'email_feedback', 'email_settings', 'checklist_step', 'auto_topup', 'topup_unknown', 'welcome_skipped', 'extension_check', 'api_report', 'reminder_shown']) {
    assert.equal(isActivityKind(k), true, k);
    assert.equal(isQualifying(k), false, k);
    assert.equal(isCounted(k), false, k);
  }
});

test("Batch 10's kinds are registered", () => {
  for (const k of ['full_analysis', 'pmi_addon', 'reminder_shown', 'reminder_acted']) assert.equal(isActivityKind(k), true, k);
  assert.equal(isQualifying('reminder_acted'), true);
});

test('the lists match the registry', () => {
  assert.deepEqual([...QUALIFYING_KINDS].sort(), Object.keys(ACTIVITY_KINDS).filter((k) => isQualifying(k)).sort());
  assert.deepEqual([...COUNTED_KINDS].sort(), Object.keys(ACTIVITY_KINDS).filter((k) => isCounted(k)).sort());
});

test('unknown kinds are refused and read as themselves', () => {
  assert.equal(isActivityKind('nope'), false);
  assert.equal(isActivityKind(undefined), false);
  assert.equal(isQualifying('nope'), false);
  assert.equal(kindLabel('some_old_kind'), 'some old kind');
  assert.equal(kindLabel('keep'), 'Kept a deal');
});
