import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChangeInput } from '../notify/message.ts';
import { notificationState } from '../notifications/registry.ts';
import { contactCanReceive, orderForText, planMemberText, textPriority, TEXT_FRESH_MS, type MemberPlanInput } from './choose.ts';
import { fitsOneSegment } from './gsm.ts';

const NOW = new Date('2026-09-26T10:00:00Z');
const H = 60 * 60 * 1000;
const LINK = 'intelligence.stayful.co.uk/my-deals';

const allOn = { ...notificationState(null), sms_price_drop: true, sms_back_on_market: true, sms_nearly_gone: true, sms_gone: true };
const contact = { phone_e164: '+447700900123', verified_at: '2026-09-01T00:00:00Z', enabled: true, stopped_at: null };

const change = (id: string, over: Partial<ChangeInput> = {}): ChangeInput & { mergedIds: string[] } => ({
  id,
  mergedIds: [],
  alertType: 'price_drop',
  kind: 'rent',
  opened: false,
  town: 'Leeds',
  type: '2 bed flat',
  stage: 'watching',
  oldAmount: 1150,
  newAmount: 1050,
  period: 'pcm',
  figure: null,
  ...over,
});

function input(over: Partial<MemberPlanInput> = {}): MemberPlanInput {
  const changes = over.changes ?? [change('a1')];
  return {
    contact,
    switches: allOn,
    changes,
    createdAt: over.createdAt ?? new Map(changes.map((c) => [c.id, NOW.getTime() - H])),
    texted: new Set(),
    slotUsedToday: false,
    sentThisMonth: 0,
    monthlyCap: 8,
    link: LINK,
    now: NOW,
    ...over,
  };
}

test('a fresh change on a verified, switched-on number is texted', () => {
  const plan = planMemberText(input());
  assert.equal(plan.send, true);
  if (plan.send) {
    assert.deepEqual(plan.alertIds, ['a1']);
    assert.ok(fitsOneSegment(plan.body));
  }
});

test('never to an unverified number, a number texts are off for, or one that replied STOP', () => {
  assert.deepEqual(planMemberText(input({ contact: { ...contact, verified_at: null } })), { send: false, reason: 'not_receiving' });
  assert.deepEqual(planMemberText(input({ contact: { ...contact, enabled: false } })), { send: false, reason: 'not_receiving' });
  assert.deepEqual(planMemberText(input({ contact: { ...contact, stopped_at: '2026-09-25T00:00:00Z' } })), { send: false, reason: 'not_receiving' });
  assert.deepEqual(planMemberText(input({ contact: null })), { send: false, reason: 'not_receiving' });
  assert.deepEqual(planMemberText(input({ contact: { ...contact, phone_e164: '+441134960000' } })), { send: false, reason: 'not_receiving' }); // a landline
});

test('switches that could not be read send nothing', () => {
  assert.deepEqual(planMemberText(input({ switches: null })), { send: false, reason: 'not_receiving' });
});

test('one text a day: a used slot sends nothing', () => {
  assert.deepEqual(planMemberText(input({ slotUsedToday: true })), { send: false, reason: 'slot_used' });
});

test('the monthly cap: the 8th text goes, the 9th does not', () => {
  assert.equal(planMemberText(input({ sentThisMonth: 7 })).send, true);
  assert.deepEqual(planMemberText(input({ sentThisMonth: 8 })), { send: false, reason: 'monthly_cap' });
});

test('only the kinds of change the member switched on', () => {
  const off = { ...allOn, sms_price_drop: false };
  assert.deepEqual(planMemberText(input({ switches: off })), { send: false, reason: 'nothing_new' });
  const plan = planMemberText(input({ switches: off, changes: [change('p'), change('g', { alertType: 'gone', status: 'sold' })] }));
  assert.equal(plan.send && plan.alertIds.join(), 'g');
});

test('an alert already texted is never texted again', () => {
  assert.deepEqual(planMemberText(input({ texted: new Set(['a1']) })), { send: false, reason: 'nothing_new' });
});

test('a newer price drop on a deal already texted about is new news', () => {
  // Batch 6 collapses drops: the settled change is the newest drop, the earlier one rides as mergedIds.
  const plan = planMemberText(input({ changes: [{ ...change('drop2', { newAmount: 990 }), mergedIds: ['drop1'] }], texted: new Set(['drop1']) }));
  assert.equal(plan.send, true);
  if (plan.send) assert.deepEqual(plan.alertIds.sort(), ['drop1', 'drop2']);
});

test('news older than 24 hours is left to the email', () => {
  const stale = new Map([['a1', NOW.getTime() - TEXT_FRESH_MS - 1]]);
  assert.deepEqual(planMemberText(input({ createdAt: stale })), { send: false, reason: 'nothing_new' });
  const edge = new Map([['a1', NOW.getTime() - TEXT_FRESH_MS]]);
  assert.equal(planMemberText(input({ createdAt: edge })).send, true);
  assert.deepEqual(planMemberText(input({ createdAt: new Map() })), { send: false, reason: 'nothing_new' }); // unknown age: not sent
});

test('several changes go in one text, and every one counted is recorded as texted', () => {
  const changes = [change('k', { stage: 'watching' }), change('o', { stage: 'offer', town: 'York' }), change('h', { alertType: 'nearly_gone', watchers: 4 })];
  const plan = planMemberText(input({ changes }));
  assert.equal(plan.send, true);
  if (plan.send) {
    assert.match(plan.body, /^Stayful: 3 deal updates\n/);
    assert.deepEqual(plan.alertIds.sort(), ['h', 'k', 'o']);
    assert.ok(plan.body.indexOf('York') < plan.body.indexOf('Leeds') || !plan.body.includes('Leeds')); // Offer first
  }
});

test('priority: drops at Offer, then Viewing/Contacted, then back/gone on those, then kept deals, attention last', () => {
  const order = [
    textPriority({ alertType: 'price_drop', stage: 'offer' }),
    textPriority({ alertType: 'price_drop', stage: 'viewing' }),
    textPriority({ alertType: 'price_drop', stage: 'contacted' }),
    textPriority({ alertType: 'back_on_market', stage: 'viewing' }),
    textPriority({ alertType: 'gone', stage: 'offer' }),
    textPriority({ alertType: 'price_drop', stage: 'watching' }),
    textPriority({ alertType: 'back_on_market', stage: null }),
    textPriority({ alertType: 'gone', stage: 'watching' }),
    textPriority({ alertType: 'nearly_gone', stage: 'offer' }),
    textPriority({ alertType: 'nearly_gone', stage: 'watching' }),
  ];
  assert.deepEqual(order, [0, 1, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('ties go to the bigger drop, then the newest', () => {
  const small = change('small', { oldAmount: 1100, newAmount: 1050 });
  const big = change('big', { oldAmount: 1300, newAmount: 1050 });
  const newer = change('newer', { oldAmount: 1100, newAmount: 1050 });
  const at = new Map([['small', 1], ['big', 1], ['newer', 2]]);
  assert.deepEqual(orderForText([small, newer, big], at).map((c) => c.id), ['big', 'newer', 'small']);
});

test('contactCanReceive needs verified, on, not stopped and a UK mobile', () => {
  assert.equal(contactCanReceive(contact), true);
  assert.equal(contactCanReceive({ ...contact, phone_e164: null }), false);
  assert.equal(contactCanReceive(undefined), false);
});

test('a planned text says which kinds of change it tells, and is withdrawn if any is switched off before sending', async () => {
  const { stillWanted } = await import('./choose.ts');
  const plan = planMemberText(input({ changes: [change('p'), change('g', { alertType: 'gone', status: 'sold' })] }));
  assert.equal(plan.send, true);
  if (plan.send) {
    assert.deepEqual([...plan.types].sort(), ['gone', 'price_drop']);
    assert.equal(stillWanted(plan.types, allOn), true);
    assert.equal(stillWanted(plan.types, { ...allOn, sms_gone: false }), false);
    assert.equal(stillWanted(plan.types, null), false);
  }
});
