import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_ENGAGEMENT_KINDS, daysQuiet, inactivityChange, inactivityEligible, inactivityState, isEngagement, isStaffEmail } from './rules.ts';
import { QUALIFYING_KINDS } from '../activity/kinds.ts';

const S = { inactiveReengageDays: 14, picksPauseInactiveDays: 25, inactivityFrom: '2026-10-01T00:00:00.000Z' };
const at = (iso: string) => new Date(iso);

test('the rules are off until inactivity_from is set', () => {
  assert.equal(daysQuiet({ lastActiveDay: null, createdAt: '2026-01-01T10:00:00Z' }, { ...S, inactivityFrom: null }, at('2026-12-01T12:00:00Z')), null);
  assert.deepEqual(inactivityState({ eligible: true, lastActiveDay: null, createdAt: '2026-01-01T10:00:00Z' }, { ...S, inactivityFrom: null }, at('2026-12-01T12:00:00Z')), { reengage: false, picksPaused: false, days: null });
});

test('counted from the latest of the last active day, sign-up and inactivity_from (the grace)', () => {
  // Signed up long ago, never active: counted from the release date, not from sign-up.
  assert.equal(daysQuiet({ lastActiveDay: null, createdAt: '2026-03-01T10:00:00Z' }, S, at('2026-10-15T12:00:00Z')), 14);
  // Active after the release date: from that day.
  assert.equal(daysQuiet({ lastActiveDay: '2026-10-10', createdAt: '2026-03-01T10:00:00Z' }, S, at('2026-10-15T12:00:00Z')), 5);
  // Signed up after the release date and never active: from sign-up (a UK day).
  assert.equal(daysQuiet({ lastActiveDay: null, createdAt: '2026-10-20T23:30:00Z' }, S, at('2026-10-22T09:00:00Z')), 1, '23:30 UTC on 20 Oct is 21 Oct in the UK (BST)');
});

test('Re-engage at 14 quiet days, picks paused at 25', () => {
  const quiet = (last: string, now: string) => inactivityState({ eligible: true, lastActiveDay: last, createdAt: '2026-09-01T10:00:00Z' }, S, at(now));
  assert.deepEqual(quiet('2026-10-02', '2026-10-15T12:00:00Z'), { reengage: false, picksPaused: false, days: 13 });
  assert.deepEqual(quiet('2026-10-02', '2026-10-16T12:00:00Z'), { reengage: true, picksPaused: false, days: 14 });
  assert.deepEqual(quiet('2026-10-02', '2026-10-26T12:00:00Z'), { reengage: true, picksPaused: false, days: 24 });
  assert.deepEqual(quiet('2026-10-02', '2026-10-27T12:00:00Z'), { reengage: true, picksPaused: true, days: 25 });
  // UK days: 00:30 BST on 16 Oct is still 15 Oct in UTC, but it is the 16th here.
  assert.equal(quiet('2026-10-02', '2026-10-15T23:30:00Z').days, 14);
});

test('who can be quiet: no plan, or a booked cancellation; never admins or Stayful accounts', () => {
  assert.equal(inactivityEligible({ planStatus: 'free', cancelBooked: false, admin: false, email: 'a@example.com' }), true);
  assert.equal(inactivityEligible({ planStatus: 'lapsed', cancelBooked: false, admin: false, email: 'a@example.com' }), true);
  for (const s of ['paid', 'subscription_trial', 'paused'] as const) {
    assert.equal(inactivityEligible({ planStatus: s, cancelBooked: false, admin: false, email: 'a@example.com' }), false, s);
    // Batch 21 (E24, Q9): a booked cancellation is still a paid plan until it ends.
    assert.equal(inactivityEligible({ planStatus: s, cancelBooked: true, admin: false, email: 'a@example.com' }), false, `${s}, cancellation booked`);
  }
  assert.equal(inactivityEligible({ planStatus: 'free', cancelBooked: false, admin: true, email: 'boss@example.com' }), false);
  assert.equal(inactivityEligible({ planStatus: 'free', cancelBooked: false, admin: false, email: 'Sam@Stayful.co.uk' }), false);
  assert.equal(isStaffEmail('sam@stayful.co.uk.evil.com'), false);
  // Ineligible: never marked, however long they have been quiet.
  assert.deepEqual(inactivityState({ eligible: false, lastActiveDay: null, createdAt: '2026-01-01T10:00:00Z' }, S, at('2026-12-01T12:00:00Z')).picksPaused, false);
});

test('the change: set what is due, clear what is not (coming back clears both)', () => {
  const none = { reengageSince: null, picksPausedAt: null };
  const both = { reengageSince: '2026-10-16T05:00:00Z', picksPausedAt: '2026-10-27T05:00:00Z' };
  assert.deepEqual(inactivityChange(none, { reengage: true, picksPaused: false, days: 14 }), { setReengage: true, clearReengage: false, setPaused: false, clearPaused: false });
  assert.deepEqual(inactivityChange({ reengageSince: '2026-10-16T05:00:00Z', picksPausedAt: null }, { reengage: true, picksPaused: true, days: 25 }), { setReengage: false, clearReengage: false, setPaused: true, clearPaused: false });
  assert.deepEqual(inactivityChange(both, { reengage: false, picksPaused: false, days: 0 }), { setReengage: false, clearReengage: true, setPaused: false, clearPaused: true });
  assert.deepEqual(inactivityChange(both, { reengage: true, picksPaused: true, days: 30 }), { setReengage: false, clearReengage: false, setPaused: false, clearPaused: false });
});

test('engaging by email or text keeps a member from being quiet, without counting towards weekly active', () => {
  for (const k of ['email_click', 'sms_click', 'email_feedback', 'email_settings', 'profile_email_click', 'feedback_email_click']) {
    assert.equal(isEngagement(k), true, k);
    assert.ok(!QUALIFYING_KINDS.includes(k as (typeof QUALIFYING_KINDS)[number]), `${k} stays out of weekly active`);
  }
  assert.equal(isEngagement('today_view'), true, 'every weekly-active kind still counts');
  assert.equal(isEngagement('keep'), true);
  for (const k of ['starter_pack_shown', 'reminder_shown', 'auto_topup', 'cookie_choice']) assert.equal(isEngagement(k), false, k);
  assert.equal(EMAIL_ENGAGEMENT_KINDS.length, 6);
});

test('an unsubscribe from an email is not engaging; changing a pick’s search from one is', () => {
  assert.equal(isEngagement('email_settings', { key: 'daily_picks', on: false, via: 'one_click' }), false);
  assert.equal(isEngagement('email_settings', { key: 'deal_changes', on: false, via: 'page' }), false);
  assert.equal(isEngagement('email_settings', { key: 'pick_search', field: 'beds' }), true);
  assert.equal(isEngagement('email_settings'), true);
  // Turning something off in the app is still in-app activity.
  assert.equal(isEngagement('today_view', { on: false }), true);
});


test('Batch 21 (E7): the extension and the API keep a member from being quiet, though they are not weekly active', () => {
  assert.equal(isEngagement('extension_check'), true);
  assert.equal(isEngagement('api_report'), true);
});

test('Batch 22f: a charged funnel lead keeps its owner out of Re-engage, but is not weekly active', async () => {
  const { isQualifying, isCounted } = await import('../activity/kinds.ts');
  assert.equal(isEngagement('funnel_lead_charged'), true);
  assert.equal(isQualifying('funnel_lead_charged'), false);
  assert.equal(isCounted('funnel_lead_charged'), false);
  // The rest of the management-company kinds are record only, and do not keep anyone from being quiet.
  for (const k of ['mc_signup', 'funnel_setup_step', 'funnel_live', 'funnel_demo_emailed', 'funnel_snippet_copied']) {
    assert.equal(isQualifying(k), false, k);
    assert.equal(isEngagement(k), false, k);
  }
});
