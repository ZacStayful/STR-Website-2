import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, GROUPS, NEVER_WRITTEN, groupOf } from './config.ts';
import { adSourceText, emailOkFor, type MemberFacts } from './facts.ts';
import { billingStatus, funnelGroup, planTier } from './precedence.ts';
import { changedColumns, columnValuesJson, currentRow, desiredRow, planLabel } from './values.ts';
import { matchMembers, type BoardItem } from './match.ts';
import { planFunnel, planTable } from './plan.ts';

const LOW = 500;
const NOW = new Date('2026-10-20T06:00:00Z');

function facts(over: Partial<MemberFacts> = {}): MemberFacts {
  return {
    userId: 'u1',
    email: 'sam@example.com',
    name: 'Sam Smith',
    mobile: '07700 900123',
    mobileKey: '+447700900123',
    createdAt: '2026-10-02T09:00:00Z',
    mondayItemId: null,
    planStatus: 'free',
    subscriptionStatus: null,
    planCode: null,
    manualNoTier: false,
    paused: false,
    cancelAt: null,
    endedAt: null,
    paidSinceEnd: false,
    balancePence: 0,
    spendableBasePence: 0,
    totalPaidPence: 0,
    paidEver: false,
    monthlyValuePence: 0,
    firstPaidAt: null,
    topups: 0,
    lastTopupAt: null,
    packBoughtAt: null,
    hitZeroAt: null,
    lastActiveDay: null,
    activeDays: 0,
    activeWeeks: 0,
    reengageSince: null,
    emailOk: true,
    smsOk: false,
    nextDeal: null,
    adSource: 'direct / unknown',
    packAccount: true,
    ...over,
  };
}

const live = { planStatus: 'paid' as const, subscriptionStatus: 'active', paidEver: true };

test('precedence, row by row', () => {
  // 2: a plan set by hand with no tier: the group is left alone.
  assert.equal(funnelGroup(facts({ planStatus: 'paid', manualNoTier: true }), LOW), 'untouched');
  // 3: past due or unpaid, over everything else.
  assert.equal(funnelGroup(facts({ ...live, planCode: 'pro', subscriptionStatus: 'past_due', reengageSince: '2026-10-01T05:00:00Z' }), LOW), 'paymentIssues');
  assert.equal(funnelGroup(facts({ planStatus: 'lapsed', subscriptionStatus: 'unpaid' }), LOW), 'paymentIssues');
  // 4: paused.
  assert.equal(funnelGroup(facts({ planStatus: 'paused', planCode: 'starter', paused: true }), LOW), 'paused');
  // 5: live plans by tier, never Re-engage.
  assert.equal(funnelGroup(facts({ ...live, planCode: 'starter', reengageSince: '2026-10-01T05:00:00Z' }), LOW), 'starter');
  assert.equal(funnelGroup(facts({ ...live, planCode: 'pro' }), LOW), 'pro');
  assert.equal(funnelGroup(facts({ ...live, planCode: 'pro_annual' }), LOW), 'pro');
  assert.equal(funnelGroup(facts({ ...live, planCode: 'scale' }), LOW), 'scale');
  assert.equal(funnelGroup(facts({ planStatus: 'subscription_trial', subscriptionStatus: 'trialing', planCode: 'starter' }), LOW), 'starter');
  // 6: Re-engage beats Cancelled and everything below.
  assert.equal(funnelGroup(facts({ ...live, planCode: 'starter', cancelAt: '2026-11-01T00:00:00Z', reengageSince: '2026-10-19T05:00:00Z' }), LOW), 'reengage');
  assert.equal(funnelGroup(facts({ reengageSince: '2026-10-19T05:00:00Z', packBoughtAt: '2026-10-02T10:00:00Z', paidEver: true }), LOW), 'reengage');
  // 7: cancellation booked (from the booking), or ended with nothing paid since.
  assert.equal(funnelGroup(facts({ ...live, planCode: 'starter', cancelAt: '2026-11-01T00:00:00Z' }), LOW), 'cancelled');
  assert.equal(funnelGroup(facts({ planStatus: 'lapsed', subscriptionStatus: 'canceled', endedAt: '2026-10-10T00:00:00Z', paidEver: true, balancePence: 200 }), LOW), 'cancelled');
  // ...but a top-up after it ended is pay as you go again.
  assert.equal(funnelGroup(facts({ planStatus: 'lapsed', subscriptionStatus: 'canceled', endedAt: '2026-10-10T00:00:00Z', paidSinceEnd: true, paidEver: true, topups: 1, balancePence: 900 }), LOW), 'payg');
  // 8: low credit: no plan, £5 or less, and paid something or joined before the pack.
  assert.equal(funnelGroup(facts({ packBoughtAt: '2026-10-02T10:00:00Z', paidEver: true, balancePence: 460 }), LOW), 'lowCredit');
  assert.equal(funnelGroup(facts({ packAccount: false, balancePence: 0 }), LOW), 'lowCredit', 'an existing member at £0');
  assert.equal(funnelGroup(facts({ packAccount: true, balancePence: 0 }), LOW), 'free', 'a new £0 sign-up is not low credit');
  assert.equal(funnelGroup(facts({ packAccount: true, balancePence: 500 }), LOW), 'free', 'the £5 profile credit alone');
  // 9: pay as you go: a paid top-up, credit above £5.
  assert.equal(funnelGroup(facts({ paidEver: true, topups: 2, balancePence: 1200, packBoughtAt: '2026-10-02T10:00:00Z' }), LOW), 'payg');
  // 10: the pack, credit above £5.
  assert.equal(funnelGroup(facts({ paidEver: true, packBoughtAt: '2026-10-02T10:00:00Z', balancePence: 2400 }), LOW), 'pack');
  // 11: everyone else.
  assert.equal(funnelGroup(facts({ packAccount: false, balancePence: 1500 }), LOW), 'free');
  assert.equal(planTier('enterprise'), null);
  assert.equal(funnelGroup(facts({ ...live, planCode: 'enterprise' }), LOW), 'untouched', 'a live plan the board has no group for');
});

test('billing status: the first that is true', () => {
  assert.equal(billingStatus(facts({ ...live, planCode: 'pro', subscriptionStatus: 'past_due' }), LOW), 'Past due');
  assert.equal(billingStatus(facts({ planStatus: 'paused', paused: true }), LOW), 'Paused');
  assert.equal(billingStatus(facts({ ...live, planCode: 'pro', cancelAt: '2026-11-01T00:00:00Z' }), LOW), 'Cancelling');
  assert.equal(billingStatus(facts({ planStatus: 'lapsed', endedAt: '2026-10-10T00:00:00Z' }), LOW), 'Cancelled');
  assert.equal(billingStatus(facts({ paidEver: true, hitZeroAt: '2026-10-15T09:00:00Z', balancePence: 0, spendableBasePence: 0 }), LOW), 'Hit zero');
  assert.equal(billingStatus(facts({ paidEver: true, balancePence: 300, spendableBasePence: 300 }), LOW), 'Low credit');
  assert.equal(billingStatus(facts({ balancePence: 0, spendableBasePence: 0 }), LOW), '', 'a new £0 sign-up that never ran out');
  assert.equal(billingStatus(facts({ ...live, planCode: 'pro', balancePence: 3000, spendableBasePence: 3000 }), LOW), '');
});

test('values: only the listed columns, never an address, postcode, link or deal figure', () => {
  const f = facts({ ...live, planCode: 'pro_annual', balancePence: 2345, spendableBasePence: 2345, totalPaidPence: 29_900, monthlyValuePence: 2492, firstPaidAt: '2026-10-03T10:00:00Z', packBoughtAt: '2026-10-03T10:00:00Z', nextDeal: '1-3m', lastActiveDay: '2026-10-19', activeDays: 6, activeWeeks: 3, smsOk: true, adSource: 'facebook / autumn / carousel' });
  const row = desiredRow(f, LOW);
  const ids = new Set<string>(Object.values(COLUMNS));
  for (const id of Object.keys(columnValuesJson(row as never))) assert.ok(ids.has(id), id);
  for (const id of NEVER_WRITTEN) assert.ok(!(id in columnValuesJson(row as never)), `never ${id}`);
  assert.equal(row.plan, 'Pro (annual)');
  assert.equal(row.credit, 23.45);
  assert.equal(row.totalPaid, 299);
  assert.equal(row.monthlyValue, 24.92);
  assert.equal(row.route, '£10 starter pack');
  assert.equal(row.nextDeal, '1–3 months', 'the board’s own label, with its en dash');
  assert.equal(row.firstPayment, '2026-10-03');
  assert.equal(row.signedUp, '2026-10-02');
  assert.equal(row.lastActive, '2026-10-19');
  const json = JSON.stringify(columnValuesJson(row as never));
  for (const bad of ['http', 'www.', 'rightmove', 'NG1 1AA', 'address']) assert.ok(!json.includes(bad), bad);
  // A plan set by hand with no tier: Plan, Total paid and Monthly value are not the site's to write.
  const manual = desiredRow(facts({ planStatus: 'paid', manualNoTier: true }), LOW);
  assert.ok(!('plan' in manual) && !('totalPaid' in manual) && !('monthlyValue' in manual));
  assert.equal(planLabel({ planStatus: 'lapsed', planCode: 'pro' }), 'Pay as you go');
  // "Not sure" and no answer leave Next deal blank.
  assert.equal(desiredRow(facts({ nextDeal: null }), LOW).nextDeal, null);
});

test('values: only what changed is written; the set-once columns only while empty; Re-engage since is cleared', () => {
  const columns: { id: string; text: string | null; value: string | null }[] = [
    { id: COLUMNS.name, text: 'Sam S (typed by sales)', value: null },
    { id: COLUMNS.email, text: 'Sam@Example.com', value: null },
    { id: COLUMNS.signedUp, text: '2026-10-02', value: '{"date":"2026-10-02","time":null}' },
    { id: COLUMNS.credit, text: '4.6', value: '"4.6"' },
    { id: COLUMNS.route, text: 'Free sign-up', value: '{"index":0}' },
    { id: COLUMNS.emailOk, text: 'v', value: '{"checked":true}' },
    { id: COLUMNS.reengageSince, text: '2026-10-01', value: '{"date":"2026-10-01"}' },
    { id: COLUMNS.firstPayment, text: '', value: null },
  ];
  const current = currentRow(columns);
  assert.equal(current.emailOk, true);
  assert.equal(current.credit, 4.6);
  const f = facts({ balancePence: 460, spendableBasePence: 460, emailOk: false, reengageSince: null, firstPaidAt: '2026-10-05T12:00:00Z', packAccount: false });
  const changes = changedColumns(current, desiredRow(f, LOW));
  assert.ok(!('name' in changes), 'a name already on the row is kept');
  assert.ok(!('email' in changes), 'so is the email as typed');
  assert.ok(!('signedUp' in changes));
  assert.ok(!('credit' in changes), '£4.60 either way');
  assert.equal(changes.firstPayment, '2026-10-05', 'empty, so written once');
  assert.equal(changes.emailOk, false, 'unticked');
  assert.equal(changes.reengageSince, null, 'cleared: they came back');
  const json = columnValuesJson(changes);
  assert.equal(json[COLUMNS.emailOk], null);
  assert.equal(json[COLUMNS.reengageSince], null);
  assert.deepEqual(json[COLUMNS.firstPayment], { date: '2026-10-05' });
  // Nothing different: nothing written.
  assert.deepEqual(changedColumns(currentRow([]), {}), {});
});

test('email OK and the ad source', () => {
  assert.equal(emailOkFor({ email: 'a@b.com', sourcing_alerts: true, alert_missed: false }), true);
  assert.equal(emailOkFor({ email: 'a@b.com', sourcing_alerts: false, alert_missed: true }), true);
  assert.equal(emailOkFor({ email: 'a@b.com', sourcing_alerts: false, alert_missed: false }), false, 'unsubscribed from both');
  assert.equal(emailOkFor({ email: null, sourcing_alerts: true, alert_missed: true }), false);
  assert.equal(adSourceText(null), 'direct / unknown');
  assert.equal(adSourceText({ utm_source: 'facebook', utm_campaign: 'Autumn Leads', utm_content: 'carousel_2' }), 'facebook / Autumn Leads / carousel_2');
  assert.equal(adSourceText({ utm_source: 'facebook', utm_campaign: 'https://evil.example.com/x', utm_content: 'NG1 1AA' }), 'facebook / - / -', 'no links, no postcodes');
});

const item = (over: Partial<BoardItem> & { id: string }): BoardItem => ({ name: 'Row', groupId: GROUPS.free, createdAt: '2026-09-01T00:00:00Z', email: null, mobile: null, columns: [], ...over });

test('matching: email exact, then ignoring case, then the number; the stored row wins; rows in Excluded leave the member alone', () => {
  const members = [
    { userId: 'a', email: 'ann@example.com', mobileKey: null, storedItemId: null, createdAt: '2026-01-01T00:00:00Z' },
    { userId: 'b', email: 'bob@example.com', mobileKey: '+447700900111', storedItemId: null, createdAt: '2026-01-02T00:00:00Z' },
    { userId: 'c', email: 'cat@example.com', mobileKey: null, storedItemId: '300', createdAt: '2026-01-03T00:00:00Z' },
    { userId: 'd', email: 'dan@example.com', mobileKey: null, storedItemId: null, createdAt: '2026-01-04T00:00:00Z' },
    { userId: 'e', email: 'eve@example.com', mobileKey: '+447700900555', storedItemId: null, createdAt: '2026-01-05T00:00:00Z' },
  ];
  const items = [
    item({ id: '100', email: 'Ann@Example.com' }),
    item({ id: '200', email: 'someone@else.com', mobile: '07700 900111' }),
    item({ id: '300', email: 'cat@example.com' }),
    item({ id: '301', email: 'cat@example.com', createdAt: '2026-08-01T00:00:00Z' }),
    item({ id: '400', email: 'dan@example.com', groupId: GROUPS.excluded }),
    item({ id: '401', email: 'dan@example.com' }),
    item({ id: '999', email: 'nobody@example.com' }),
  ];
  const r = matchMembers(members, items);
  assert.equal(r.matched.get('a')?.item.id, '100');
  assert.equal(r.matched.get('a')?.via, 'email_case');
  assert.equal(r.matched.get('b')?.item.id, '200');
  assert.equal(r.matched.get('b')?.via, 'mobile');
  assert.equal(r.matched.get('c')?.item.id, '300', 'the stored row, though 301 is older');
  assert.deepEqual(r.duplicates.find((d) => d.userId === 'c'), { userId: 'c', kept: '300', others: ['301'] });
  assert.ok(!r.matched.has('d') && r.excluded.get('d')?.id === '400', 'a row in Excluded: left alone, and no other row touched');
  assert.ok(!r.matched.has('e'), 'no row');
  assert.ok(![...r.matched.values()].some((m) => m.item.id === '999'), 'a row nobody matches is untouched');
});

test('one row, two members: the email match wins over the number; a member without a row is not given someone else’s', () => {
  const members = [
    { userId: 'old', email: 'first@example.com', mobileKey: '+447700900222', storedItemId: null, createdAt: '2026-01-01T00:00:00Z' },
    { userId: 'new', email: 'second@example.com', mobileKey: '+447700900222', storedItemId: null, createdAt: '2026-05-01T00:00:00Z' },
  ];
  const r = matchMembers(members, [item({ id: '10', email: 'second@example.com', mobile: '07700900222' })]);
  assert.equal(r.matched.get('new')?.item.id, '10');
  assert.ok(!r.matched.has('old'));
  // Two members matching only by the same number: the older account keeps it.
  const r2 = matchMembers(members, [item({ id: '11', email: 'x@example.com', mobile: '+44 7700 900222' })]);
  assert.equal(r2.matched.get('old')?.item.id, '11');
  assert.ok(!r2.matched.has('new'));
});

test('the plan: moves, writes, links and creates, and never a second row', () => {
  const now = NOW;
  const opts = { lowCreditPence: LOW, now, createMissing: true, createMinAgeMs: 3_600_000 };
  const members = [
    facts({ userId: 'pack', email: 'pack@example.com', mobileKey: null, packBoughtAt: '2026-10-03T10:00:00Z', paidEver: true, balancePence: 2400, spendableBasePence: 2400, totalPaidPence: 1000, firstPaidAt: '2026-10-03T10:00:00Z' }),
    facts({ userId: 'fresh', email: 'fresh@example.com', mobileKey: null, createdAt: '2026-10-20T05:30:00Z' }),
    facts({ userId: 'nobody', email: 'nobody@example.com', mobileKey: null, createdAt: '2026-10-01T00:00:00Z', packAccount: false, balancePence: 1500, spendableBasePence: 1500 }),
    facts({ userId: 'hand', email: 'hand@example.com', mobileKey: null, planStatus: 'paid', manualNoTier: true }),
    facts({ userId: 'confirm', email: 'confirm@example.com', mobileKey: null, ...live, planCode: 'pro' }),
    facts({ userId: 'ex', email: 'ex@example.com', mobileKey: null }),
  ];
  const items = [
    item({ id: '1', email: 'pack@example.com', groupId: GROUPS.free }),
    item({ id: '2', email: 'hand@example.com', groupId: GROUPS.toConfirm }),
    item({ id: '3', email: 'confirm@example.com', groupId: GROUPS.toConfirm }),
    item({ id: '4', email: 'ex@example.com', groupId: GROUPS.excluded }),
  ];
  const p = planFunnel(members, items, opts);
  const byUser = new Map(p.updates.map((u) => [u.userId, u]));
  assert.equal(byUser.get('pack')?.to, 'pack');
  assert.equal(byUser.get('pack')?.changes.route, '£10 starter pack');
  assert.equal(byUser.get('pack')?.changes.totalPaid, 10);
  assert.equal(byUser.get('hand')?.to ?? null, null, 'plan to confirm, state unknown: stays');
  assert.equal(byUser.get('confirm')?.to, 'pro', 'plan to confirm, state known: moved');
  assert.ok(!byUser.has('ex') && p.excluded.includes('ex'));
  assert.deepEqual(p.links.find((l) => l.userId === 'ex'), { userId: 'ex', itemId: '4' });
  assert.deepEqual(p.noRow, [{ userId: 'fresh', reason: 'too_new' }]);
  assert.equal(p.creates.length, 1);
  assert.equal(p.creates[0].userId, 'nobody');
  assert.equal(p.creates[0].group, 'free');
  assert.equal(p.creates[0].changes.email, 'nobody@example.com');
  // The queue never creates.
  assert.equal(planFunnel(members, items, { ...opts, createMissing: false }).creates.length, 0);
  // Run again against the board as written: nothing left to do for the pack member.
  const written = item({ id: '1', email: 'pack@example.com', groupId: GROUPS.pack, columns: Object.entries(columnValuesJson(byUser.get('pack')!.changes)).map(([id, v]) => ({ id, text: typeof v === 'string' ? v : v && typeof v === 'object' && 'label' in v ? String((v as { label: string }).label) : v && typeof v === 'object' && 'date' in v ? String((v as { date: string }).date) : '', value: v === null ? null : JSON.stringify(v) })) });
  const again = planFunnel([members[0]], [written], opts);
  assert.equal(again.updates.length, 0, JSON.stringify(again.updates));
  assert.equal(again.unchanged, 1);
  const table = planTable(p, (id) => `${id}@example.com`);
  assert.ok(table.some((r) => r.group === '1. Free sign-up → 2. £10 starter pack'));
  assert.ok(table.some((r) => r.row === 'new' && r.group === '(no row) → 1. Free sign-up'));
  assert.equal(groupOf('group_unknown'), null);
});
