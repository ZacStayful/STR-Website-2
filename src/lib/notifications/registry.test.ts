import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTIFICATION_TYPES, NOTIFICATION_COLUMNS, isNotificationKey, notificationPatch, notificationState, notificationType } from './registry.ts';

test('the three switches of this batch are registered, each with a column and a one-line description', () => {
  assert.deepEqual(NOTIFICATION_TYPES.map((t) => t.key), ['daily_picks', 'weekly_alerts', 'credit_alerts']);
  for (const t of NOTIFICATION_TYPES) {
    assert.ok(t.label.length > 0);
    assert.ok(t.description.length > 0 && !t.description.includes('\n'));
    assert.ok(NOTIFICATION_COLUMNS.split(', ').includes(t.column), `${t.column} is selected`);
  }
});

test('a missing column reads as the default, a false column reads as off', () => {
  assert.deepEqual(notificationState(null), { daily_picks: true, weekly_alerts: true, credit_alerts: true });
  assert.deepEqual(notificationState({ sourcing_alerts: false, alert_weekly: null }), { daily_picks: false, weekly_alerts: true, credit_alerts: true });
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
