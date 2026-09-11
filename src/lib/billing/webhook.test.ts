import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleStripeEvent, type Crm, type WebhookDeps } from './webhook.ts';
import { PAUSED_FROM_KEY } from '../subscription.ts';

// The webhook is driven entirely through injected clients, so these tests
// exercise the real matching and write logic with no network and no Stripe
// account. Fakes are hand-built the same way src/lib/subscription.test.ts
// builds its subscription fixtures.

const unix = (s: string) => Math.floor(Date.parse(s) / 1000);
const PERIOD_END = '2026-07-14T00:00:00.000Z';

type Row = Record<string, unknown>;

/**
 * Minimal stand-in for the service-role Supabase client, supporting exactly
 * the three query shapes the handler uses: eq→maybeSingle, ilike→limit, and
 * update→eq. Records every write so a test can assert on it.
 */
function fakeAdmin(rows: Row[]) {
  const writes: { id: unknown; values: Row }[] = [];
  const client = {
    from() {
      return {
        select() {
          const q = {
            eq(col: string, val: unknown) {
              return {
                maybeSingle: async () => ({ data: rows.find((r) => r[col] === val) ?? null }),
              };
            },
            ilike(col: string, val: string) {
              return {
                limit: async () => ({
                  data: rows.filter(
                    (r) => String(r[col] ?? '').toLowerCase() === String(val).toLowerCase(),
                  ),
                }),
              };
            },
          };
          return q;
        },
        update(values: Row) {
          return {
            eq: async (_col: string, id: unknown) => {
              writes.push({ id, values });
              const row = rows.find((r) => r.id === id);
              if (row) Object.assign(row, values);
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { client, writes, rows };
}

function fakeCrm() {
  const calls: string[] = [];
  const crm: Crm = {
    async subscriptionStarted(email) {
      calls.push(`started:${email}`);
    },
    async subscriptionCancelled(email) {
      calls.push(`cancelled:${email}`);
    },
  };
  return { crm, calls };
}

function subscription(over: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status: 'active',
    start_date: unix('2026-01-14T00:00:00Z'),
    cancel_at: null,
    pause_collection: null,
    metadata: {},
    items: { data: [{ current_period_end: unix(PERIOD_END) }] },
    ...over,
  };
}

function fakeStripe(over: Record<string, unknown> = {}) {
  return {
    customers: { retrieve: async () => ({ deleted: false, email: null }) },
    subscriptions: {
      retrieve: async () => subscription(),
      list: async () => ({ data: [] }),
    },
    ...over,
  };
}

function profileRow(over: Row = {}): Row {
  return {
    id: 'user_1',
    email: 'member@example.com',
    plan: 'free',
    plan_source: null,
    stripe_subscription_id: null,
    stripe_subscription_status: null,
    ...over,
  };
}

function deps(rows: Row[], stripeOver: Record<string, unknown> = {}) {
  const admin = fakeAdmin(rows);
  const crm = fakeCrm();
  return {
    admin,
    crm,
    d: {
      admin: admin.client,
      stripe: fakeStripe(stripeOver),
      crm: crm.crm,
    } as unknown as WebhookDeps,
  };
}

const subEvent = (sub: unknown, type = 'customer.subscription.updated') =>
  ({ type, data: { object: sub } }) as never;

// ---------------------------------------------------------------
// Matching
// ---------------------------------------------------------------

test('a subscription event matches the profile by subscription id', async () => {
  const rows = [profileRow({ stripe_subscription_id: 'sub_1' })];
  const { d, admin } = deps(rows);
  await handleStripeEvent(d, subEvent(subscription()));
  assert.equal(admin.writes.length, 1);
  assert.equal(admin.writes[0].values.plan, 'pro');
});

test('a hand-arranged subscription matches by customer id and is linked', async () => {
  // The case PR #27 existed for: no Checkout Session, so the profile has no
  // subscription id yet and only the customer id can match.
  const rows = [profileRow({ stripe_customer_id: 'cus_1' })];
  const { d, admin } = deps(rows);
  await handleStripeEvent(d, subEvent(subscription()));
  assert.equal(admin.writes[0].values.stripe_subscription_id, 'sub_1');
  assert.equal(admin.writes[0].values.plan, 'pro');
});

test('email matching is case-insensitive', async () => {
  const rows = [profileRow({ email: 'Member@Example.com' })];
  const { d, admin } = deps(rows, {
    customers: { retrieve: async () => ({ deleted: false, email: 'MEMBER@example.COM' }) },
  });
  await handleStripeEvent(d, subEvent(subscription()));
  assert.equal(admin.writes.length, 1);
});

test('an unmatched payment writes nothing rather than crediting the wrong account', async () => {
  const { d, admin } = deps([profileRow({ email: 'someone.else@example.com' })]);
  await handleStripeEvent(d, subEvent(subscription()));
  assert.equal(admin.writes.length, 0);
});

// ---------------------------------------------------------------
// Pause
// ---------------------------------------------------------------

const paused = subscription({
  pause_collection: { behavior: 'void', resumes_at: unix('2026-09-14T00:00:00Z') },
  metadata: { [PAUSED_FROM_KEY]: PERIOD_END },
});

test('a pause writes both ends of the window', async () => {
  const rows = [profileRow({ stripe_subscription_id: 'sub_1', plan: 'pro' })];
  const { d, admin } = deps(rows);
  await handleStripeEvent(d, subEvent(paused));
  const w = admin.writes[0].values;
  assert.equal(w.subscription_paused_from, PERIOD_END);
  assert.equal(w.subscription_paused_until, '2026-09-14T00:00:00.000Z');
  assert.equal(w.subscription_current_period_end, PERIOD_END);
});

test('a pause is not churn — no cancellation date reaches the CRM', async () => {
  // pause_collection leaves the Stripe status on 'active', so the live/not-live
  // transition never fires. Logging a cancel date here would be wrong: the
  // member has not left.
  const rows = [profileRow({ stripe_subscription_id: 'sub_1', plan: 'pro', stripe_subscription_status: 'active' })];
  const { d, crm } = deps(rows);
  await handleStripeEvent(d, subEvent(paused));
  assert.deepEqual(crm.calls, []);
});

test('an auto-resume clears the pause window', async () => {
  // Stripe sends customer.subscription.updated with pause_collection: null at
  // resumes_at. Stale metadata must not keep the member locked out.
  const rows = [
    profileRow({
      stripe_subscription_id: 'sub_1',
      plan: 'pro',
      subscription_paused_from: PERIOD_END,
      subscription_paused_until: '2026-09-14T00:00:00.000Z',
    }),
  ];
  const { d, admin } = deps(rows);
  await handleStripeEvent(d, subEvent(subscription({ metadata: { [PAUSED_FROM_KEY]: PERIOD_END } })));
  const w = admin.writes[0].values;
  assert.equal(w.subscription_paused_from, null);
  assert.equal(w.subscription_paused_until, null);
  assert.equal(w.plan, 'pro');
});

// ---------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------

test('a scheduled cancellation stores the date without revoking access', async () => {
  const rows = [profileRow({ stripe_subscription_id: 'sub_1', plan: 'pro' })];
  const { d, admin, crm } = deps(rows);
  await handleStripeEvent(d, subEvent(subscription({ cancel_at: unix('2026-07-14T00:00:00Z') })));
  const w = admin.writes[0].values;
  assert.equal(w.subscription_cancel_at, PERIOD_END);
  assert.equal(w.plan, 'pro', 'still paying until the date arrives');
  // They can still undo it, so the CRM must not record them as churned.
  assert.deepEqual(crm.calls, []);
});

test('undoing a cancellation clears the date and the captured reason', async () => {
  const rows = [
    profileRow({
      stripe_subscription_id: 'sub_1',
      plan: 'pro',
      subscription_cancel_at: PERIOD_END,
      cancel_reason: 'too_expensive',
    }),
  ];
  const { d, admin } = deps(rows);
  await handleStripeEvent(d, subEvent(subscription({ cancel_at: null })));
  const w = admin.writes[0].values;
  assert.equal(w.subscription_cancel_at, null);
  assert.equal(w.cancel_reason, null);
  assert.equal(w.cancel_reason_at, null);
});

test('a real cancellation revokes access and is logged as churn', async () => {
  const rows = [
    profileRow({ stripe_subscription_id: 'sub_1', plan: 'pro', stripe_subscription_status: 'active' }),
  ];
  const { d, admin, crm } = deps(rows);
  await handleStripeEvent(
    d,
    subEvent(subscription({ status: 'canceled' }), 'customer.subscription.deleted'),
  );
  const w = admin.writes[0].values;
  assert.equal(w.plan, 'free');
  assert.deepEqual(crm.calls, ['cancelled:member@example.com']);
});

test('a late delete for a superseded subscription does not lock out a paying customer', async () => {
  // Monthly → annual creates a new subscription and cancels the old one, and
  // Stripe does not guarantee event order.
  const rows = [
    profileRow({ stripe_subscription_id: 'sub_1', plan: 'pro', stripe_subscription_status: 'active' }),
  ];
  const { d, admin, crm } = deps(rows, {
    subscriptions: {
      retrieve: async () => subscription(),
      list: async () => ({ data: [subscription({ id: 'sub_2', status: 'active' })] }),
    },
  });
  await handleStripeEvent(
    d,
    subEvent(subscription({ status: 'canceled' }), 'customer.subscription.deleted'),
  );
  assert.equal(admin.writes[0].values.plan, 'pro');
  assert.equal(admin.writes[0].values.stripe_subscription_id, 'sub_2');
  assert.deepEqual(crm.calls, []);
});

// ---------------------------------------------------------------
// Re-subscribe
// ---------------------------------------------------------------

test('re-subscribing clears a stale pause and cancel', async () => {
  // Without this a lapsed member could pay and still be locked out by the
  // pause window left on their row.
  const rows = [
    profileRow({
      stripe_subscription_id: 'sub_1',
      plan: 'free',
      stripe_subscription_status: 'canceled',
      subscription_paused_from: '2026-01-01T00:00:00.000Z',
      subscription_paused_until: '2099-01-01T00:00:00.000Z',
      subscription_cancel_at: '2026-02-01T00:00:00.000Z',
    }),
  ];
  const { d, admin } = deps(rows);
  await handleStripeEvent(d, subEvent(subscription(), 'customer.subscription.created'));
  const w = admin.writes[0].values;
  assert.equal(w.plan, 'pro');
  assert.equal(w.subscription_paused_from, null);
  assert.equal(w.subscription_paused_until, null);
  assert.equal(w.subscription_cancel_at, null);
});

test('a manual plan grant is not revoked by a stray Stripe event', async () => {
  const rows = [
    profileRow({ stripe_subscription_id: 'sub_1', plan: 'pro', plan_source: 'manual' }),
  ];
  const { d, admin } = deps(rows);
  await handleStripeEvent(d, subEvent(subscription({ status: 'canceled' })));
  const w = admin.writes[0].values;
  assert.equal(w.plan, undefined, 'the plan column is left alone');
  assert.equal(w.stripe_subscription_status, 'canceled', 'but Stripe is still recorded');
});

test('past_due keeps access — Stripe is still retrying the card', async () => {
  const rows = [profileRow({ stripe_subscription_id: 'sub_1', plan: 'pro' })];
  const { d, admin } = deps(rows);
  await handleStripeEvent(d, subEvent(subscription({ status: 'past_due' })));
  assert.equal(admin.writes[0].values.plan, 'pro');
});

test('an unrecognised event type is ignored', async () => {
  const { d, admin } = deps([profileRow({ stripe_subscription_id: 'sub_1' })]);
  await handleStripeEvent(d, subEvent(subscription(), 'invoice.upcoming'));
  assert.equal(admin.writes.length, 0);
});
