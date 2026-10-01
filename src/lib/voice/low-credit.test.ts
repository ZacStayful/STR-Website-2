import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestLanding, lowCreditTriggered, spentFromLedger, type GrantRow } from './low-credit.ts';
import { DEFAULT_VOICE } from './settings.ts';

const g = (id: string, kind: string, amount: number, ref: string | null, at: string): GrantRow => ({ id, kind, amount_pence: amount, source_ref: ref, created_at: at });

test('the newest top-up or plan credit is the landing; referral, promo and admin credit are not', () => {
  const l = latestLanding([
    g('a', 'topup', 2500, 'pi:1', '2026-10-01T10:00:00Z'),
    g('b', 'adjustment', 1000, 'referral:x:y', '2026-10-03T10:00:00Z'),
    g('c', 'welcome', 500, 'profile_complete:u', '2026-10-04T10:00:00Z'),
    g('d', 'adjustment', 0, 'overdraft:u', '2026-10-05T10:00:00Z'),
  ]);
  assert.deepEqual(l, { id: 'a', amountPence: 2500, landedAt: new Date('2026-10-01T10:00:00Z') });
  assert.equal(latestLanding([g('p', 'plan', 1900, 'inv:1', '2026-10-02T00:00:00Z'), g('a', 'topup', 1000, 'pi:1', '2026-10-01T00:00:00Z')])?.id, 'p');
  assert.equal(latestLanding([g('b', 'adjustment', 1000, 'code:x:u', '2026-10-03T10:00:00Z')]), null);
});

test('the starter pack\'s two grants are one landing of £30', () => {
  const l = latestLanding([
    g('paid', 'topup', 1000, 'pi:ABC', '2026-10-01T10:00:00.100Z'),
    g('bonus', 'welcome', 2000, 'pack_bonus:ABC', '2026-10-01T10:00:00.200Z'),
  ]);
  assert.deepEqual(l, { id: 'paid', amountPence: 3000, landedAt: new Date('2026-10-01T10:00:00.100Z') });
});

const landing = { id: 'a', amountPence: 2500, landedAt: new Date('2026-10-01T10:00:00Z') };
const input = (o = {}) => ({ balancePence: 450, lowCreditPence: 500, landing, spentSincePence: 2050, now: new Date('2026-10-05T10:00:00Z'), settings: DEFAULT_VOICE, ...o });

test('fires at £5 left with 80% of a fresh top-up spent inside 7 days', () => {
  assert.equal(lowCreditTriggered(input()), true);
  assert.equal(lowCreditTriggered(input({ spentSincePence: 2000 })), true); // exactly 80%
  assert.equal(lowCreditTriggered(input({ spentSincePence: 1999 })), false);
  assert.equal(lowCreditTriggered(input({ balancePence: 501 })), false);
  assert.equal(lowCreditTriggered(input({ now: new Date('2026-10-08T10:00:01Z') })), false); // more than 7 days after
  assert.equal(lowCreditTriggered(input({ landing: null })), false);
});

test('spend from the ledger: debits less refunds, in face pence', () => {
  assert.equal(spentFromLedger([{ kind: 'debit', amount_pence: -100 }, { kind: 'debit', amount_pence: -65 }, { kind: 'refund', amount_pence: 40 }, { kind: 'grant', amount_pence: 2500 }]), 125);
});
