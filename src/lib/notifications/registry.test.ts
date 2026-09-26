import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTIFICATION_TYPES, NOTIFICATION_COLUMNS, isNotificationKey, notificationPatch, notificationState, notificationType } from './registry.ts';

test('every switch is registered, each with a column and a one-line description', () => {
  assert.deepEqual(NOTIFICATION_TYPES.map((t) => t.key), ['daily_picks', 'deal_changes', 'weekly_missed', 'weekly_alerts', 'credit_alerts', 'sms_price_drop', 'sms_back_on_market', 'sms_nearly_gone', 'sms_gone']);
  for (const t of NOTIFICATION_TYPES) {
    assert.ok(t.label.length > 0);
    assert.ok(t.description.length > 0 && !t.description.includes('\n'));
    assert.ok(NOTIFICATION_COLUMNS.split(', ').includes(t.column), `${t.column} is selected`);
  }
});

test('a missing column reads as the default, a false column reads as off', () => {
  const texts = { sms_price_drop: false, sms_back_on_market: false, sms_nearly_gone: false, sms_gone: false };
  assert.deepEqual(notificationState(null), { daily_picks: true, deal_changes: true, weekly_missed: true, weekly_alerts: true, credit_alerts: true, ...texts });
  assert.deepEqual(notificationState({ sourcing_alerts: false, alert_weekly: null }), { daily_picks: false, deal_changes: true, weekly_missed: true, weekly_alerts: true, credit_alerts: true, ...texts });
  assert.equal(notificationState({ alert_credit: false }).credit_alerts, false);
});

test('turning daily picks off stamps the opt-out; turning them on clears it', () => {
  const now = new Date('2026-09-25T10:00:00Z');
  assert.deepEqual(notificationPatch('daily_picks', false, now), { sourcing_alerts: false, sourcing_opted_out_at: '2026-09-25T10:00:00.000Z' });
  assert.deepEqual(notificationPatch('daily_picks', true, now), { sourcing_alerts: true, sourcing_opted_out_at: null });
});

test('the other switches write only their own column', () => {
  assert.deepEqual(notificationPatch('weekly_alerts', false), { alert_weekly: false });
  assert.deepEqual(notificationPatch('credit_alerts', true), { alert_credit: true });
});

test('keys from a form are validated, never trusted', () => {
  assert.equal(isNotificationKey('daily_picks'), true);
  assert.equal(isNotificationKey('sourcing_alerts'), false);
  assert.equal(isNotificationKey(''), false);
  assert.equal(isNotificationKey(null), false);
  assert.throws(() => notificationType('nope' as never));
});

test('Batch 6: the two new switches are on by default and write only their own column', () => {
  assert.equal(notificationType('deal_changes').column, 'alert_tracked');
  assert.equal(notificationType('weekly_missed').column, 'alert_missed');
  assert.deepEqual(notificationPatch('deal_changes', false), { alert_tracked: false });
  assert.deepEqual(notificationPatch('weekly_missed', false), { alert_missed: false });
  assert.equal(notificationState({ alert_tracked: false }).deal_changes, false);
  assert.equal(notificationState({ alert_missed: null }).weekly_missed, true);
});

test('the pre-Batch-6 column list is the full list minus the Batch 6 and Batch 8 columns', async () => {
  const { NOTIFICATION_COLUMNS_BEFORE_BATCH_6 } = await import('./registry.ts');
  const full = new Set(NOTIFICATION_COLUMNS.split(', '));
  const before = NOTIFICATION_COLUMNS_BEFORE_BATCH_6.split(', ');
  for (const c of before) assert.ok(full.has(c));
  assert.deepEqual([...full].filter((c) => !before.includes(c)).sort(), ['alert_missed', 'alert_tracked', 'sms_back_on_market', 'sms_gone', 'sms_nearly_gone', 'sms_price_drop']);
});

test('Batch 8: the text switches are their own channel, off by default, and only listed under texts', async () => {
  const { EMAIL_NOTIFICATION_TYPES, SMS_NOTIFICATION_TYPES, SMS_NOTIFICATION_KEYS, NOTIFICATION_COLUMNS_BEFORE_BATCH_8, notificationsPatch } = await import('./registry.ts');
  assert.deepEqual(SMS_NOTIFICATION_KEYS, ['sms_price_drop', 'sms_back_on_market', 'sms_nearly_gone', 'sms_gone']);
  for (const t of SMS_NOTIFICATION_TYPES) {
    assert.equal(t.defaultOn, false, `${t.key} starts off`);
    assert.equal(t.column, t.key);
  }
  assert.ok(EMAIL_NOTIFICATION_TYPES.every((t) => !t.key.startsWith('sms_')));
  assert.equal(EMAIL_NOTIFICATION_TYPES.length + SMS_NOTIFICATION_TYPES.length, NOTIFICATION_TYPES.length);
  // A database without the text columns falls back to the Batch 6 list: the texts read as off.
  assert.deepEqual([...NOTIFICATION_COLUMNS.split(', ')].filter((c) => !NOTIFICATION_COLUMNS_BEFORE_BATCH_8.split(', ').includes(c)).sort(), ['sms_back_on_market', 'sms_gone', 'sms_nearly_gone', 'sms_price_drop']);
  assert.deepEqual(notificationsPatch(SMS_NOTIFICATION_KEYS, true), { sms_price_drop: true, sms_back_on_market: true, sms_nearly_gone: true, sms_gone: true });
  assert.deepEqual(notificationPatch('sms_gone', false), { sms_gone: false });
  assert.equal(isNotificationKey('sms_price_drop'), true);
});
