import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reminderEvent, reminderWhere, takeUpFigures, type TakeUpEvent } from './take-up.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const D1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const D2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const D3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const ev = (user_id: string, kind: string, deal_id: string | null, extras: Record<string, unknown> = {}, at = '2026-09-20T10:00:00Z'): TakeUpEvent => ({ user_id, kind, deal_id, extras, occurred_at: at });

test('reminderEvent: one key per member, deal, where and stage; never a bad token', () => {
  const e = reminderEvent('shown', { dealId: D1, where: 'stage', stage: 'offer' });
  assert.deepEqual(e, { dedupeKey: `reminder_shown:stage:${D1}:offer`, extras: { where: 'stage', stage: 'offer' } });
  assert.equal(reminderEvent('acted', { dealId: D1, where: 'kept_step', stage: 'watching' })?.dedupeKey, `reminder_acted:kept_step:${D1}:watching`);
  assert.equal(reminderEvent('shown', { dealId: D1, where: 'email', stage: 'offer' }), null);
  assert.equal(reminderEvent('shown', { dealId: D1, where: 'stage', stage: 'nowhere' }), null);
  assert.equal(reminderEvent('shown', { dealId: 'l-123', where: 'stage', stage: 'offer' }), null);
  assert.equal(reminderEvent('shown', { dealId: null, where: 'stage', stage: 'offer' }), null);
  assert.equal(reminderWhere('kept_step'), 'kept_step');
  assert.equal(reminderWhere(undefined), null);
});

test('takeUpFigures: Full analysis take-up is per member and deal opened', () => {
  const f = takeUpFigures(
    [
      ev(A, 'deal_open', D1),
      ev(A, 'deal_open', D2),
      ev(A, 'full_analysis', D1, { via: 'upgrade', reused: false, pmi_ticked: false, pmi: false }),
      // Bought in one go: the open inside it is logged too, counted once.
      ev(B, 'deal_open', D3, { via: 'full_analysis' }),
      ev(B, 'full_analysis', D3, { via: 'one_tap', reused: true, pmi_ticked: true, pmi: true }),
      // A daily pick has no deal_open: bought outright still counts as opened.
      ev(B, 'full_analysis', D2, { via: 'upgrade', reused: false, pmi_ticked: true, pmi: false }),
    ],
    new Set(),
  );
  assert.deepEqual(f.analysis, { opened: 4, analysed: 3, bought: 3, oneTap: 1, afterLook: 2, reused: 1 });
  assert.deepEqual(f.pmi, { analyses: 3, atPurchase: 1, later: 0, noAnswer: 1 });
});

test('takeUpFigures: PMI added later from the report', () => {
  const f = takeUpFigures([ev(A, 'full_analysis', D1, { via: 'upgrade' }), ev(A, 'pmi_addon', D1, { from: 'report' })], new Set());
  assert.equal(f.pmi.later, 1);
  assert.equal(f.pmi.analyses, 1);
});

test('takeUpFigures: reminders shown, acted on, and bought after acting', () => {
  const f = takeUpFigures(
    [
      ev(A, 'reminder_shown', D1, { where: 'stage', stage: 'contacted' }, '2026-09-20T09:00:00Z'),
      ev(A, 'reminder_shown', D2, { where: 'stage', stage: 'offer' }, '2026-09-20T09:00:00Z'),
      ev(A, 'reminder_shown', D3, { where: 'kept_step', stage: 'watching' }, '2026-09-20T09:00:00Z'),
      ev(A, 'reminder_acted', D1, { where: 'stage', stage: 'contacted' }, '2026-09-20T09:05:00Z'),
      ev(A, 'full_analysis', D1, { via: 'upgrade' }, '2026-09-20T09:06:00Z'),
      // Acted on, but the analysis never completed.
      ev(A, 'reminder_acted', D3, { where: 'kept_step', stage: 'watching' }, '2026-09-20T09:07:00Z'),
      // An older Full analysis of the deal does not count as bought after acting.
      ev(B, 'full_analysis', D2, { via: 'upgrade' }, '2026-09-19T09:00:00Z'),
      ev(B, 'reminder_acted', D2, { where: 'stage', stage: 'offer' }, '2026-09-20T09:00:00Z'),
    ],
    new Set(),
  );
  assert.equal(f.reminders.shown, 3);
  assert.equal(f.reminders.acted, 3);
  assert.equal(f.reminders.bought, 1);
  assert.deepEqual(f.reminders.byWhere, { stage: { shown: 2, acted: 2 }, kept_step: { shown: 1, acted: 1 } });
});

test('takeUpFigures: excluded accounts and preview events are left out', () => {
  const f = takeUpFigures(
    [
      ev(ADMIN, 'full_analysis', D1, { via: 'one_tap' }),
      ev(A, 'full_analysis', D2, { via: 'one_tap', env: 'preview' }),
      ev(A, 'reminder_shown', D2, { where: 'stage', stage: 'offer', env: 'preview' }),
      ev(B, 'deal_open', D3),
    ],
    new Set([ADMIN]),
  );
  assert.equal(f.analysis.bought, 0);
  assert.equal(f.analysis.opened, 1);
  assert.equal(f.reminders.shown, 0);
});
