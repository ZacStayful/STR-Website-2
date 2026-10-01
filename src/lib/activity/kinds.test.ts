import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_KINDS, COUNTED_KINDS, QUALIFYING_KINDS, isActivityKind, isCounted, isQualifying, kindLabel, planActivityKind } from './kinds.ts';

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

test('subscription changes the member made become activity; the rest do not', () => {
  assert.equal(planActivityKind('started', 'stripe'), 'plan_start');
  assert.equal(planActivityKind('started', 'manual'), null, 'a plan granted by hand is not the member starting one');
  assert.equal(planActivityKind('plan_changed', 'self_serve'), 'plan_change');
  assert.equal(planActivityKind('paused', 'self_serve'), 'plan_pause');
  assert.equal(planActivityKind('cancel_scheduled', 'self_serve'), 'plan_cancel');
  assert.equal(planActivityKind('cancel_reverted', 'self_serve'), 'plan_cancel_undone');
  // Batch 21 (E15, E19, E20): a pause, a plan change or a cancellation seen from Stripe is the app's own (already logged) or the admin's in the dashboard; one made in the portal is the member's.
  for (const k of ['plan_changed', 'paused', 'resumed', 'cancel_scheduled', 'cancel_reverted']) assert.equal(planActivityKind(k, 'stripe'), null, k);
  assert.equal(planActivityKind('plan_changed', 'portal'), 'plan_change');
  assert.equal(planActivityKind('paused', 'portal'), 'plan_pause');
  assert.equal(planActivityKind('cancel_scheduled', 'portal'), 'plan_cancel');
  assert.equal(planActivityKind('cancel_reverted', 'portal'), 'plan_cancel_undone');
  assert.equal(planActivityKind('cancel_scheduled', 'manual'), null);
  assert.equal(planActivityKind('resumed', 'self_serve'), 'plan_resume');
  assert.equal(planActivityKind('ended', 'stripe'), null);
  assert.equal(planActivityKind('past_due', 'stripe'), null);
  assert.equal(planActivityKind('recovered', 'stripe'), null);
});

test("Batch 18's kinds: taps count towards weekly active, what is only shown or clicked in an email does not", () => {
  for (const k of ['feedback_opened', 'feedback_sent', 'announcement_dismissed', 'announcement_clicked']) {
    assert.equal(isActivityKind(k), true, k);
    assert.equal(isQualifying(k), true, k);
    assert.equal(isCounted(k), true, k);
  }
  for (const k of ['announcement_shown', 'feedback_email_click']) {
    assert.equal(isActivityKind(k), true, k);
    assert.equal(isQualifying(k), false, k);
    assert.equal(isCounted(k), false, k);
  }
});

test("Batch 19's cookie choice is recorded but can never count towards weekly active", () => {
  assert.equal(isActivityKind('cookie_choice'), true);
  assert.equal(isQualifying('cookie_choice'), false);
  assert.equal(isCounted('cookie_choice'), false);
});

test("Batch 20's kinds: buying the pack and choosing at low credit count; being shown the pack and 'Not now' do not", () => {
  for (const k of ['starter_pack', 'low_credit_starter', 'low_credit_topup']) {
    assert.equal(isActivityKind(k), true, k);
    assert.equal(isQualifying(k), true, k);
  }
  for (const k of ['starter_pack_shown', 'starter_pack_not_now']) {
    assert.equal(isActivityKind(k), true, k);
    assert.equal(isQualifying(k), false, k);
    assert.equal(isCounted(k), false, k);
  }
});

test("Batch 21's kinds: looking at the Explorer or My deals, working leads and funnels, leaving or removing a seat and connecting the extension count; a STOP, a START and an API PDF only record", () => {
  for (const k of ['explorer_view', 'my_deals_view', 'lead_action', 'funnel_edited', 'api_key_created', 'team_leave', 'team_remove', 'extension_connected']) {
    assert.equal(isActivityKind(k), true, k);
    assert.equal(isQualifying(k), true, k);
  }
  for (const k of ['sms_stop', 'sms_start', 'api_pdf', 'profile_started', 'profile_resumed']) {
    assert.equal(isActivityKind(k), true, k);
    assert.equal(isQualifying(k), false, k);
  }
});
