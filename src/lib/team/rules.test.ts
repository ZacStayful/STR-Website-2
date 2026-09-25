import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SEAT_PRICE_PENCE, periodEnd, inviteExpiry, seatDue, normaliseEmail, joinBlocker, can,
  JOIN_BLOCKER_COPY, type JoinFacts,
} from './rules.ts';

const now = new Date('2026-09-25T10:00:00Z');
const OWNER = '00000000-0000-0000-0000-00000000000a';
const USER = '00000000-0000-0000-0000-00000000000b';

function facts(over: Partial<JoinFacts> = {}, invite: Partial<NonNullable<JoinFacts['invite']>> = {}): JoinFacts {
  return {
    invite: { expiresAt: '2026-10-01T00:00:00Z', acceptedAt: null, revokedAt: null, email: 'sam@agency.co.uk', ownerId: OWNER, ...invite },
    userId: USER,
    userEmail: 'Sam@Agency.co.uk',
    isMember: false,
    ownsTeamData: false,
    hasSubscription: false,
    ...over,
  };
}

test('a seat is a flat £10', () => {
  assert.equal(SEAT_PRICE_PENCE, 1000);
});

test('a seat period is 30 days and falls due exactly at its end', () => {
  const start = new Date('2026-09-01T12:00:00Z');
  const end = periodEnd(start);
  assert.equal(end.toISOString(), '2026-10-01T12:00:00.000Z');
  assert.equal(seatDue(end, new Date(end.getTime() - 1)), false);
  assert.equal(seatDue(end, end), true);
  assert.equal(seatDue('not a date', now), false);
});

test('invites last 7 days', () => {
  assert.equal(inviteExpiry(now).toISOString(), '2026-10-02T10:00:00.000Z');
});

test('emails are compared lower-cased and trimmed', () => {
  assert.equal(normaliseEmail('  Sam@Agency.CO.uk '), 'sam@agency.co.uk');
  assert.equal(normaliseEmail('not-an-email'), null);
  assert.equal(normaliseEmail(undefined), null);
});

test('a valid invite for the right person can be accepted', () => {
  assert.equal(joinBlocker(facts(), now), null);
});

test('every reason someone cannot join is caught, in a sensible order', () => {
  assert.equal(joinBlocker(facts({ invite: null }), now), 'invalid');
  assert.equal(joinBlocker(facts({}, { acceptedAt: '2026-09-20T00:00:00Z' }), now), 'used');
  assert.equal(joinBlocker(facts({}, { revokedAt: '2026-09-20T00:00:00Z' }), now), 'used');
  assert.equal(joinBlocker(facts({}, { expiresAt: '2026-09-25T10:00:00Z' }), now), 'expired');
  assert.equal(joinBlocker(facts({ userId: OWNER }), now), 'own_team');
  assert.equal(joinBlocker(facts({ userEmail: 'other@agency.co.uk' }), now), 'wrong_email');
  assert.equal(joinBlocker(facts({ isMember: true }), now), 'already_member');
  assert.equal(joinBlocker(facts({ ownsTeamData: true }), now), 'owns_data');
  assert.equal(joinBlocker(facts({ hasSubscription: true }), now), 'subscribed');
});

test('every blocker has customer-facing copy', () => {
  for (const b of ['invalid', 'expired', 'used', 'wrong_email', 'own_team', 'already_member', 'owns_data', 'subscribed'] as const) {
    assert.ok(JOIN_BLOCKER_COPY[b].length > 10);
  }
});

test('members work leads; everything else is the owner’s', () => {
  assert.equal(can('member', 'leads'), true);
  for (const c of ['funnels', 'integrations', 'api_keys', 'billing', 'team'] as const) {
    assert.equal(can('member', c), false, c);
    assert.equal(can('owner', c), true, c);
  }
});

test('the schema enforces one team per login and no double seat charge', () => {
  const sql = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /member_id uuid primary key references public\.profiles\(id\) on delete cascade/);
  assert.match(sql, /constraint team_seat_charges_period_key unique \(member_id, period_start\)/);
});
