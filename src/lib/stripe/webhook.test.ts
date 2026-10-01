import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { handleStripeEvent, reasonFromStripeFeedback, type WebhookActivity, type WebhookDeps } from './webhook.ts';
import type { SubscriptionEventInput } from '../billing/subscription-events.ts';
import { dedupeKeyFor, purchaseFromTopup, subscribeFromInvoice } from '../meta/events.ts';

const env = { STRIPE_PRICE_STARTER: 'price_starter', STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_PRO_ANNUAL: 'price_annual' };

function fakeDeps() {
  const calls: Record<string, unknown[][]> = {};
  const rec = (name: string) => (...args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const user = {
    id: 'u1',
    email: 'a@example.com',
    plan_code: 'starter' as string | null,
    cancel_reason: null as string | null,
    cancel_reason_comment: null as string | null,
    subscription_cancel_at: null as string | null,
    subscription_paused_until: null as string | null,
    stripe_subscription_status: null as string | null,
  };
  const sub = (priceId: string, status = 'active', cancel = false): Stripe.Subscription =>
    ({ id: 'sub_1', status, cancel_at_period_end: cancel, customer: 'cus_1', items: { data: [{ price: { id: priceId }, current_period_end: 1_800_000_000 }] } }) as unknown as Stripe.Subscription;
  let subscription: Stripe.Subscription | null = sub('price_starter');
  const events: SubscriptionEventInput[] = [];
  const activity: WebhookActivity[] = [];
  const deps: WebhookDeps & {
    calls: typeof calls;
    setSub: (s: Stripe.Subscription | null) => void;
    events: SubscriptionEventInput[];
    activity: WebhookActivity[];
    user: typeof user;
  } = {
    events,
    activity,
    user,
    env,
    calls,
    setSub: (s) => {
      subscription = s;
    },
    findUserBySubscription: async (id) => (id === 'sub_1' ? user : null),
    findUserByCustomer: async (id) => (id === 'cus_1' ? user : null),
    findUserByEmail: async (e) => (e === user.email ? user : null),
    findUserById: async (id) => (id === 'u1' ? user : null),
    updateProfile: async (...a) => rec('updateProfile')(...a),
    grantPlanCycle: async (...a) => rec('grantPlanCycle')(...a),
    grantUpgradeDifference: async (...a) => rec('grantUpgradeDifference')(...a),
    grantTopup: async (...a) => {
      rec('grantTopup')(...a);
      return true;
    },
    expirePlanGrants: async (...a) => {
      rec('expirePlanGrants')(...a);
      return 1;
    },
    savePaymentMethod: async (...a) => rec('savePaymentMethod')(...a),
    retrievePaymentIntent: async (id) => ({ id, payment_method: 'pm_1', customer: 'cus_1', amount: 2500, amount_received: 2500, metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500' } }) as unknown as Stripe.PaymentIntent,
    retrieveSubscription: async () => subscription,
    refundTopup: async (...a) => rec('refundTopup')(...a),
    onSubscriptionStarted: async (...a) => rec('onSubscriptionStarted')(...a),
    onSubscriptionCancelled: async (...a) => rec('onSubscriptionCancelled')(...a),
    paymentFailedEmail: async (...a) => rec('paymentFailedEmail')(...a),
    cardNeedsUpdateEmail: async (...a) => rec('cardNeedsUpdateEmail')(...a),
    recordSubscriptionEvent: async (input) => {
      events.push(input);
    },
    logActivity: async (input) => {
      activity.push(input);
    },
    restoreDisputedCredit: async (...a) => {
      rec('restoreDisputedCredit')(...a);
      return 2500;
    },
    log: () => {},
  };
  return deps;
}

const ev = (type: string, object: unknown): Stripe.Event => ({ id: `evt_${type}`, type, data: { object } }) as unknown as Stripe.Event;

test('invoice.paid on subscription_create grants a plan cycle expiring at the period end', async () => {
  const deps = fakeDeps();
  const invoice = { id: 'in_1', customer: 'cus_1', billing_reason: 'subscription_create', parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ period: { end: 1_800_000_000 }, pricing: { price_details: { price: 'price_starter' } } }] } };
  const r = await handleStripeEvent(ev('invoice.paid', invoice), deps);
  assert.equal(r.handled, true);
  const [userId, planCode, sourceRef, periodEnd] = deps.calls.grantPlanCycle![0];
  assert.equal(userId, 'u1');
  assert.equal(planCode, 'starter');
  assert.equal(sourceRef, 'inv:in_1');
  assert.equal((periodEnd as Date).getTime(), 1_800_000_000 * 1000);
  const patch = deps.calls.updateProfile![0][1] as Record<string, unknown>;
  assert.equal(patch.stripe_price_id, 'price_starter');
  assert.equal(patch.plan, 'pro');
});

test('invoice.paid with subscription_update grants the upgrade difference, not a new cycle', async () => {
  const deps = fakeDeps();
  deps.setSub({ id: 'sub_1', status: 'active', cancel_at_period_end: false, customer: 'cus_1', items: { data: [{ price: { id: 'price_pro' }, current_period_end: 1_800_000_000 }] } } as unknown as Stripe.Subscription);
  const invoice = { id: 'in_2', customer: 'cus_1', billing_reason: 'subscription_update', parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [] } };
  const r = await handleStripeEvent(ev('invoice.paid', invoice), deps);
  assert.equal(r.handled, true);
  assert.equal(deps.calls.grantPlanCycle, undefined);
  const [, from, to, ref] = deps.calls.grantUpgradeDifference![0];
  assert.equal(from, 'starter');
  assert.equal(to, 'pro');
  assert.equal(ref, 'inv:in_2');
});

test('annual invoices grant one month now with an annual: source ref', async () => {
  const deps = fakeDeps();
  deps.setSub({ id: 'sub_1', status: 'active', cancel_at_period_end: false, customer: 'cus_1', items: { data: [{ price: { id: 'price_annual' }, current_period_end: Math.floor(Date.now() / 1000) + 365 * 86400 }] } } as unknown as Stripe.Subscription);
  const invoice = { id: 'in_3', customer: 'cus_1', billing_reason: 'subscription_create', parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [] } };
  await handleStripeEvent(ev('invoice.paid', invoice), deps);
  const [, planCode, sourceRef, periodEnd] = deps.calls.grantPlanCycle![0];
  assert.equal(planCode, 'pro_annual');
  assert.match(String(sourceRef), /^annual:sub_1:\d{4}-\d{2}$/);
  const days = ((periodEnd as Date).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 27 && days < 32, `month slot expiry, got ${days} days`);
});

test('invoice.paid for an unknown price is ignored', async () => {
  const deps = fakeDeps();
  deps.setSub({ id: 'sub_1', status: 'active', customer: 'cus_1', items: { data: [{ price: { id: 'price_other' }, current_period_end: 1 }] } } as unknown as Stripe.Subscription);
  const r = await handleStripeEvent(ev('invoice.paid', { id: 'in_4', customer: 'cus_1', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [] } }), deps);
  assert.equal(r.handled, false);
  assert.equal(deps.calls.grantPlanCycle, undefined);
});

test('subscription deleted expires plan credit and drops the plan', async () => {
  const deps = fakeDeps();
  const r = await handleStripeEvent(ev('customer.subscription.deleted', { id: 'sub_1', status: 'canceled', customer: 'cus_1', cancel_at_period_end: false, items: { data: [{ price: { id: 'price_starter' }, current_period_end: 1 }] } }), deps);
  assert.equal(r.handled, true);
  assert.equal(deps.calls.expirePlanGrants![0][1], 'subscription_ended');
  const patch = deps.calls.updateProfile![0][1] as Record<string, unknown>;
  assert.equal(patch.plan_code, null);
  assert.equal(patch.plan, 'free');
  assert.equal(deps.calls.onSubscriptionCancelled![0][0], 'a@example.com');
});

test('subscription updated with cancel_at_period_end keeps the plan and credit', async () => {
  const deps = fakeDeps();
  await handleStripeEvent(ev('customer.subscription.updated', { id: 'sub_1', status: 'active', customer: 'cus_1', cancel_at_period_end: true, items: { data: [{ price: { id: 'price_starter' }, current_period_end: 1_800_000_000 }] } }), deps);
  assert.equal(deps.calls.expirePlanGrants, undefined);
  const patch = deps.calls.updateProfile![0][1] as Record<string, unknown>;
  assert.equal(patch.cancel_at_period_end, true);
  assert.equal(patch.plan_code, 'starter');
});

test('payment_intent.succeeded for a top-up saves the card and grants once', async () => {
  const deps = fakeDeps();
  const pi = { id: 'pi_9', customer: 'cus_1', payment_method: 'pm_9', amount: 2500, amount_received: 2500, metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500' } };
  const r = await handleStripeEvent(ev('payment_intent.succeeded', pi), deps);
  assert.equal(r.handled, true);
  assert.deepEqual(deps.calls.savePaymentMethod![0], ['u1', 'cus_1', 'pm_9']);
  const [userId, amount, ref] = deps.calls.grantTopup![0];
  assert.equal(userId, 'u1');
  assert.equal(amount, 2500);
  assert.equal(ref, 'pi:pi_9');
});

test('payment_intent.succeeded that is not a top-up is ignored', async () => {
  const deps = fakeDeps();
  const r = await handleStripeEvent(ev('payment_intent.succeeded', { id: 'pi_x', metadata: {} }), deps);
  assert.equal(r.handled, false);
  assert.equal(deps.calls.grantTopup, undefined);
});

test('checkout.session.completed in payment mode saves the card and grants the top-up; subscription mode only records ids', async () => {
  const deps = fakeDeps();
  await handleStripeEvent(ev('checkout.session.completed', { id: 'cs_1', mode: 'payment', client_reference_id: 'u1', customer: 'cus_1', payment_intent: 'pi_7', amount_total: 2500, consent: { terms_of_service: 'accepted' }, customer_details: { email: 'a@example.com' } }), deps);
  assert.equal(deps.calls.grantTopup![0][2], 'pi:pi_7');
  assert.ok((deps.calls.updateProfile![0][1] as Record<string, unknown>).terms_accepted_at);

  const deps2 = fakeDeps();
  await handleStripeEvent(ev('checkout.session.completed', { id: 'cs_2', mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_1', customer_details: { email: 'a@example.com' } }), deps2);
  assert.equal(deps2.calls.grantTopup, undefined);
  assert.equal(deps2.calls.grantPlanCycle, undefined);
  const patch = deps2.calls.updateProfile![0][1] as Record<string, unknown>;
  assert.equal(patch.stripe_subscription_id, 'sub_1');
  assert.equal(patch.plan_code, 'starter');
  assert.equal(deps2.calls.onSubscriptionStarted![0][0], 'a@example.com');
});

test('invoice.payment_failed marks past_due and emails', async () => {
  const deps = fakeDeps();
  await handleStripeEvent(ev('invoice.payment_failed', { id: 'in_f', customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1' } } }), deps);
  assert.equal((deps.calls.updateProfile![0][1] as Record<string, unknown>).stripe_subscription_status, 'past_due');
  assert.equal(deps.calls.paymentFailedEmail![0][0], 'a@example.com');
});

test('charge.refunded on a top-up claws the credit back', async () => {
  const deps = fakeDeps();
  await handleStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_9', amount_refunded: 2500 }), deps);
  assert.deepEqual(deps.calls.refundTopup![0], ['u1', 'pi:pi_9', 2500, 'refunded']);
});

// ---------------------------------------------------------------------------
// Pause / cancel mirroring and event-order guards
// ---------------------------------------------------------------------------

const subObj = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  status: 'active',
  customer: 'cus_1',
  cancel_at_period_end: false,
  cancel_at: null,
  start_date: 1_700_000_000,
  pause_collection: null,
  metadata: {},
  items: { data: [{ price: { id: 'price_starter' }, current_period_end: 1_800_000_000 }] },
  ...over,
});

test('a pause writes both ends of the window and keeps the plan and credit', async () => {
  const deps = fakeDeps();
  const r = await handleStripeEvent(
    ev('customer.subscription.updated', subObj({ pause_collection: { behavior: 'void', resumes_at: 1_810_000_000 }, metadata: { stayful_paused_from: '2027-01-15T00:00:00.000Z' } })),
    deps,
  );
  assert.equal(r.handled, true);
  assert.equal(deps.calls.expirePlanGrants, undefined);
  const patch = deps.calls.updateProfile![0][1] as Record<string, unknown>;
  assert.equal(patch.subscription_paused_from, '2027-01-15T00:00:00.000Z');
  assert.equal(patch.subscription_paused_until, new Date(1_810_000_000 * 1000).toISOString());
  assert.equal(patch.plan_code, 'starter');
  assert.equal(patch.plan_source, 'stripe');
  // A pause is not churn — no cancellation reaches the CRM.
  assert.equal(deps.calls.onSubscriptionCancelled, undefined);
});

test('an auto-resume clears the pause window by itself', async () => {
  const deps = fakeDeps();
  await handleStripeEvent(ev('customer.subscription.updated', subObj()), deps);
  const patch = deps.calls.updateProfile![0][1] as Record<string, unknown>;
  assert.equal(patch.subscription_paused_from, null);
  assert.equal(patch.subscription_paused_until, null);
  assert.equal(patch.subscription_ended_at, null);
  assert.equal(patch.subscription_started_at, new Date(1_700_000_000 * 1000).toISOString());
});

test('a scheduled cancellation stores the date; undoing it clears the captured reason', async () => {
  const deps = fakeDeps();
  await handleStripeEvent(ev('customer.subscription.updated', subObj({ cancel_at_period_end: true, cancel_at: 1_800_000_000 })), deps);
  const booked = deps.calls.updateProfile![0][1] as Record<string, unknown>;
  assert.equal(booked.subscription_cancel_at, new Date(1_800_000_000 * 1000).toISOString());
  assert.equal('cancel_reason' in booked, false);

  await handleStripeEvent(ev('customer.subscription.updated', subObj()), deps);
  const undone = deps.calls.updateProfile![1][1] as Record<string, unknown>;
  assert.equal(undone.subscription_cancel_at, null);
  assert.equal(undone.cancel_reason, null);
  assert.equal(undone.cancel_reason_at, null);
});

test('a late delete for a superseded subscription does not expire the credit the customer is paying for', async () => {
  const deps = fakeDeps();
  deps.listSubscriptions = async () => [subObj({ id: 'sub_new', status: 'active' }) as unknown as Stripe.Subscription];
  const r = await handleStripeEvent(ev('customer.subscription.deleted', subObj({ status: 'canceled' })), deps);
  assert.equal(r.handled, false);
  assert.equal(deps.calls.expirePlanGrants, undefined);
  assert.equal(deps.calls.updateProfile, undefined);
});

test('customer.subscription.created links a subscription arranged by hand in the dashboard', async () => {
  const deps = fakeDeps();
  deps.findUserBySubscription = async () => null;
  const r = await handleStripeEvent(ev('customer.subscription.created', subObj({ id: 'sub_hand' })), deps);
  assert.equal(r.handled, true);
  const patch = deps.calls.updateProfile![0][1] as Record<string, unknown>;
  assert.equal(patch.stripe_subscription_id, 'sub_hand');
  assert.equal(patch.stripe_customer_id, 'cus_1');
  assert.equal(patch.plan_code, 'starter');
  // Credit is not granted here — it follows invoice.paid.
  assert.equal(deps.calls.grantPlanCycle, undefined);
});

test('a manual plan grant is not revoked by a stray dead-subscription event', async () => {
  const deps = fakeDeps();
  const manual = { id: 'u1', email: 'a@example.com', plan_code: 'pro', plan_source: 'manual' };
  deps.findUserBySubscription = async () => manual;
  await handleStripeEvent(ev('customer.subscription.deleted', subObj({ status: 'canceled' })), deps);
  const patch = deps.calls.updateProfile![0][1] as Record<string, unknown>;
  assert.equal(patch.stripe_subscription_status, 'canceled');
  assert.equal('plan_code' in patch, false);
  assert.equal('plan' in patch, false);
});

// ---------------------------------------------------------------
// Churn capture
// ---------------------------------------------------------------

const deadSub = (over: Partial<Record<string, unknown>> = {}): Stripe.Subscription =>
  ({
    id: 'sub_1',
    status: 'canceled',
    cancel_at_period_end: false,
    cancel_at: null,
    customer: 'cus_1',
    start_date: 1_700_000_000,
    items: { data: [{ price: { id: 'price_starter' }, current_period_end: 1_800_000_000 }] },
    ...over,
  }) as unknown as Stripe.Subscription;

test('REGRESSION: the cancel reason survives the subscription actually ending', async () => {
  // It used to be wiped here. Stripe clears cancel_at when a subscription
  // ends, and the old code read that as "they changed their mind" — deleting
  // the reason at the exact moment it became the answer to why they left.
  const deps = fakeDeps();
  deps.user.cancel_reason = 'too_expensive';
  deps.user.cancel_reason_comment = 'costs more than I get out of it';

  const r = await handleStripeEvent(ev('customer.subscription.deleted', deadSub()), deps);
  assert.equal(r.handled, true);

  const patch = deps.calls.updateProfile![0][1] as Record<string, unknown>;
  assert.ok(!('cancel_reason' in patch) || patch.cancel_reason !== null, 'must not null the reason on the way out');
  assert.equal(patch.subscription_ended_at !== undefined, true);
});

test('a live subscription that un-cancels still clears the reason', async () => {
  // The other half of the same branch: still live and no longer cancelling
  // really does mean the reason describes nothing.
  const deps = fakeDeps();
  const live = { id: 'sub_1', status: 'active', cancel_at_period_end: false, cancel_at: null, customer: 'cus_1', start_date: 1_700_000_000, items: { data: [{ price: { id: 'price_starter' }, current_period_end: 1_800_000_000 }] } } as unknown as Stripe.Subscription;
  await handleStripeEvent(ev('customer.subscription.updated', live), deps);
  const patch = deps.calls.updateProfile![0][1] as Record<string, unknown>;
  assert.equal(patch.cancel_reason, null);
});

test('the ended event logs the reason the member gave us', async () => {
  const deps = fakeDeps();
  deps.user.cancel_reason = 'not_using';
  deps.user.cancel_reason_comment = 'too busy';
  await handleStripeEvent(ev('customer.subscription.deleted', deadSub()), deps);

  const ended = deps.events.find((e) => e.kind === 'ended')!;
  assert.equal(ended.reason, 'not_using');
  assert.equal(ended.reasonComment, 'too busy');
  assert.equal(ended.source, 'self_serve');
  assert.equal(ended.cycleStartedAt, new Date(1_700_000_000 * 1000).toISOString());
});

test('a portal cancel is rescued from Stripe cancellation_details', async () => {
  // Nobody cancelling in the Stripe portal ever reaches our own flow, so this
  // is the only place their reason can come from.
  const deps = fakeDeps();
  const sub = deadSub({ cancellation_details: { feedback: 'missing_features', comment: 'no API' } });
  await handleStripeEvent(ev('customer.subscription.deleted', sub), deps);

  const ended = deps.events.find((e) => e.kind === 'ended')!;
  assert.equal(ended.reason, 'missing_feature');
  assert.equal(ended.reasonComment, 'no API');
  assert.equal(ended.source, 'portal');
});

test('a subscription that dies past due is logged as payment_failed', async () => {
  const deps = fakeDeps();
  deps.user.stripe_subscription_status = 'past_due';
  await handleStripeEvent(ev('customer.subscription.deleted', deadSub({ status: 'unpaid' })), deps);

  const ended = deps.events.find((e) => e.kind === 'ended')!;
  assert.equal(ended.reason, 'payment_failed', 'an involuntary churn is still a churn');
  assert.equal(ended.source, 'stripe');
});

test('a churn with nothing attached logs no invented reason', async () => {
  const deps = fakeDeps();
  await handleStripeEvent(ev('customer.subscription.deleted', deadSub()), deps);
  assert.equal(deps.events.find((e) => e.kind === 'ended')!.reason, null);
});

test('a scheduled cancellation is logged once, on the way in', async () => {
  const deps = fakeDeps();
  const cancelling = { id: 'sub_1', status: 'active', cancel_at_period_end: true, cancel_at: 1_800_000_000, customer: 'cus_1', start_date: 1_700_000_000, items: { data: [{ price: { id: 'price_starter' }, current_period_end: 1_800_000_000 }] } } as unknown as Stripe.Subscription;

  await handleStripeEvent(ev('customer.subscription.updated', cancelling), deps);
  assert.equal(deps.events.filter((e) => e.kind === 'cancel_scheduled').length, 1);

  // Stripe re-sends the whole object on every update. Now that the profile
  // carries the state, a repeat must not log a second time.
  deps.user.subscription_cancel_at = new Date(1_800_000_000 * 1000).toISOString();
  await handleStripeEvent(ev('customer.subscription.updated', cancelling), deps);
  assert.equal(deps.events.filter((e) => e.kind === 'cancel_scheduled').length, 1);
});

test('undoing a cancellation logs cancel_reverted', async () => {
  const deps = fakeDeps();
  deps.user.subscription_cancel_at = '2027-01-01T00:00:00.000Z';
  const live = { id: 'sub_1', status: 'active', cancel_at_period_end: false, cancel_at: null, customer: 'cus_1', start_date: 1_700_000_000, items: { data: [{ price: { id: 'price_starter' }, current_period_end: 1_800_000_000 }] } } as unknown as Stripe.Subscription;
  await handleStripeEvent(ev('customer.subscription.updated', live), deps);
  assert.equal(deps.events.filter((e) => e.kind === 'cancel_reverted').length, 1);
  // The webhook sees no portal source on a revert, so it leaves the activity
  // log to the app, which records the member's own undo as self_serve (E20).
  assert.equal(deps.activity.some((a) => a.kind === 'plan_cancel_undone'), false);
});

test('a failed invoice logs past_due once per episode', async () => {
  const deps = fakeDeps();
  const invoice = { id: 'in_2', customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1' } } };
  await handleStripeEvent(ev('invoice.payment_failed', invoice), deps);
  assert.equal(deps.events.filter((e) => e.kind === 'past_due').length, 1);

  deps.user.stripe_subscription_status = 'past_due';
  await handleStripeEvent(ev('invoice.payment_failed', invoice), deps);
  assert.equal(deps.events.filter((e) => e.kind === 'past_due').length, 1, 'same episode, not a new one');
});

test('a card that goes through after failing logs recovered', async () => {
  const deps = fakeDeps();
  deps.user.stripe_subscription_status = 'past_due';
  const invoice = { id: 'in_3', customer: 'cus_1', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ period: { end: 1_800_000_000 }, pricing: { price_details: { price: 'price_starter' } } }] } };
  await handleStripeEvent(ev('invoice.paid', invoice), deps);
  assert.equal(deps.events.filter((e) => e.kind === 'recovered').length, 1);
});

test('a churn log that throws does not fail the delivery', async () => {
  // The route records the event id BEFORE handling, so a throw here would have
  // Stripe retry the whole handler and re-run the grant expiry.
  const deps = fakeDeps();
  deps.recordSubscriptionEvent = async () => {
    throw new Error('database on fire');
  };
  const r = await handleStripeEvent(ev('customer.subscription.deleted', deadSub()), deps);
  assert.equal(r.handled, true);
  assert.equal(deps.calls.expirePlanGrants!.length, 1);
});

test('reasonFromStripeFeedback maps every Stripe value to something we report', () => {
  assert.equal(reasonFromStripeFeedback('too_expensive'), 'too_expensive');
  assert.equal(reasonFromStripeFeedback('switched_service'), 'another_tool');
  assert.equal(reasonFromStripeFeedback('unused'), 'not_using');
  assert.equal(reasonFromStripeFeedback('low_quality'), 'other');
  assert.equal(reasonFromStripeFeedback('something_new_stripe_added'), 'other');
  assert.equal(reasonFromStripeFeedback(null), null);
});

// ── Batch 9: the activity log ──

test('a top-up is logged as the member topping up, keyed like the app logs it', async () => {
  const deps = fakeDeps();
  const pi = { id: 'pi_9', customer: 'cus_1', payment_method: 'pm_9', amount: 2500, amount_received: 2500, metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500' } };
  await handleStripeEvent(ev('payment_intent.succeeded', pi), deps);
  assert.deepEqual(deps.activity, [{ userId: 'u1', kind: 'topup', dedupeKey: 'topup:pi:pi_9', source: undefined, extras: { amount_pence: 2500 } }]);
});

test('an automatic top-up is logged as automatic, never as the member', async () => {
  const deps = fakeDeps();
  const pi = { id: 'pi_a', customer: 'cus_1', payment_method: 'pm_9', amount: 2000, amount_received: 2000, metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2000', auto: '1' } };
  await handleStripeEvent(ev('payment_intent.succeeded', pi), deps);
  assert.equal(deps.activity.length, 1);
  assert.equal(deps.activity[0].kind, 'auto_topup');
  assert.equal(deps.activity[0].source, 'system');
  assert.equal(deps.activity[0].dedupeKey, 'topup:pi:pi_a');
});

test('a Checkout top-up is logged once, with the payment as its key', async () => {
  const deps = fakeDeps();
  await handleStripeEvent(ev('checkout.session.completed', { id: 'cs_1', mode: 'payment', client_reference_id: 'u1', customer: 'cus_1', payment_intent: 'pi_7', amount_total: 2500, customer_details: { email: 'a@example.com' } }), deps);
  assert.deepEqual(deps.activity.map((a) => [a.kind, a.dedupeKey]), [['topup', 'topup:pi:pi_7']]);
});

test('a new subscription reported twice is one plan start', async () => {
  const deps = fakeDeps();
  await handleStripeEvent(ev('checkout.session.completed', { id: 'cs_2', mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_1', customer_details: { email: 'a@example.com' } }), deps);
  await handleStripeEvent(ev('customer.subscription.created', subObj()), deps);
  const starts = deps.activity.filter((a) => a.kind === 'plan_start');
  assert.ok(starts.length >= 1);
  assert.deepEqual([...new Set(starts.map((a) => a.dedupeKey))], ['plan_start:sub_1']);
});

test('a cancellation booked in the portal is logged; Stripe ending or resuming by itself is not', async () => {
  const deps = fakeDeps();
  // A portal cancellation carries Stripe's own cancellation feedback, which is
  // how the webhook tells it from an admin cancelling in the dashboard (E20).
  await handleStripeEvent(ev('customer.subscription.updated', subObj({ cancel_at_period_end: true, cancel_at: 1_800_000_000, cancellation_details: { feedback: 'too_expensive' } })), deps);
  assert.deepEqual(deps.activity.map((a) => a.kind), ['plan_cancel']);
  assert.match(deps.activity[0].dedupeKey ?? '', /^sub:evt_customer\.subscription\.updated:cancel_scheduled$/);

  const resumed = fakeDeps();
  resumed.user.subscription_paused_until = '2026-01-01T00:00:00.000Z';
  await handleStripeEvent(ev('customer.subscription.updated', subObj()), resumed);
  assert.equal(resumed.activity.some((a) => a.kind === 'plan_resume'), false);

  const ended = fakeDeps();
  await handleStripeEvent(ev('customer.subscription.deleted', subObj({ status: 'canceled' })), ended);
  assert.equal(ended.activity.length, 0);
});

test('a cancellation made in the Stripe dashboard is recorded for churn but not logged as the member cancelling (E20)', async () => {
  const deps = fakeDeps();
  // No in-app reason and no Stripe feedback: the webhook labels it 'stripe',
  // which may be the admin acting in the dashboard, so it is not the member's.
  await handleStripeEvent(ev('customer.subscription.updated', subObj({ cancel_at_period_end: true, cancel_at: 1_800_000_000 })), deps);
  assert.equal(deps.events.filter((e) => e.kind === 'cancel_scheduled').length, 1, 'still recorded in the churn log');
  assert.equal(deps.events.find((e) => e.kind === 'cancel_scheduled')?.source, 'stripe');
  assert.equal(
    deps.activity.some((a) => a.kind === 'plan_cancel'),
    false,
    'a dashboard cancellation is not a weekly-active action',
  );
});

test('a cancellation the member made in the app is logged by the app, not a second time by the webhook (E20)', async () => {
  const deps = fakeDeps();
  deps.user.cancel_reason = 'too_expensive';
  await handleStripeEvent(ev('customer.subscription.updated', subObj({ cancel_at_period_end: true, cancel_at: 1_800_000_000 })), deps);
  assert.equal(deps.events.find((e) => e.kind === 'cancel_scheduled')?.source, 'self_serve');
  assert.equal(
    deps.activity.some((a) => a.kind === 'plan_cancel'),
    false,
    'the app already logged the self-serve cancellation; the webhook does not repeat it',
  );
});

test('a subscription on a plan granted by hand is not the member starting a plan', async () => {
  const deps = fakeDeps();
  deps.findUserBySubscription = async () => ({ id: 'u1', email: 'a@example.com', plan_code: 'pro', plan_source: 'manual' });
  await handleStripeEvent(ev('customer.subscription.created', subObj()), deps);
  assert.equal(deps.events.find((e) => e.kind === 'started')?.source, 'manual');
  assert.equal(deps.activity.filter((a) => a.kind === 'plan_start').length, 0);
});

test('an activity log that throws does not fail the delivery', async () => {
  const deps = fakeDeps();
  deps.logActivity = async () => {
    throw new Error('down');
  };
  const pi = { id: 'pi_9', customer: 'cus_1', payment_method: 'pm_9', amount: 2500, amount_received: 2500, metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500' } };
  const r = await handleStripeEvent(ev('payment_intent.succeeded', pi), deps);
  assert.equal(r.handled, true);
  assert.equal(deps.calls.grantTopup!.length, 1);
});

// ── Batch 19: Meta's Subscribe and Purchase ──
// The fake records with the same once-only key and rules as src/lib/meta/conversions.ts.
const TRACKING_SINCE = '2026-09-01T00:00:00.000Z';

function withConversions(deps: ReturnType<typeof fakeDeps>) {
  const recorded: Array<{ key: string; name: string; eventId: string | null; valuePence: number }> = [];
  deps.recordConversion = async (c) => {
    const key = dedupeKeyFor(c.name, { userId: c.userId, paymentIntentId: c.name === 'Purchase' ? c.paymentIntentId : null });
    if (!key || recorded.some((r) => r.key === key)) return;
    const v = c.name === 'Subscribe' ? subscribeFromInvoice(c.invoice, TRACKING_SINCE) : purchaseFromTopup(c.topup);
    if (v) recorded.push({ key, name: c.name, eventId: c.eventId, valuePence: v.valuePence });
  };
  return recorded;
}

const subStarted = (iso: string) =>
  ({ id: 'sub_1', status: 'active', start_date: Date.parse(iso) / 1000, cancel_at_period_end: false, customer: 'cus_1', items: { data: [{ price: { id: 'price_starter' }, current_period_end: 1_800_000_000 }] } }) as unknown as Stripe.Subscription;

const paidInvoice = (id: string, reason: string, paid: number, exVat: number) => ({
  id,
  customer: 'cus_1',
  billing_reason: reason,
  amount_paid: paid,
  total_excluding_tax: exVat,
  currency: 'gbp',
  parent: { subscription_details: { subscription: 'sub_1' } },
  lines: { data: [{ period: { end: 1_800_000_000 }, pricing: { price_details: { price: 'price_starter' } } }] },
});

test('Batch 19: a Checkout top-up and its payment_intent.succeeded, each delivered twice, are one Purchase at the credit bought', async () => {
  const deps = fakeDeps();
  const recorded = withConversions(deps);
  const session = { id: 'cs_1', mode: 'payment', client_reference_id: 'u1', customer: 'cus_1', payment_intent: 'pi_7', amount_total: 3000, customer_details: { email: 'a@example.com' } };
  const pi = { id: 'pi_7', customer: 'cus_1', payment_method: 'pm_1', amount: 3000, amount_received: 3000, currency: 'gbp', metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500' } };
  for (let i = 0; i < 2; i += 1) {
    await handleStripeEvent(ev('checkout.session.completed', session), deps);
    await handleStripeEvent(ev('payment_intent.succeeded', pi), deps);
  }
  assert.deepEqual(recorded, [{ key: 'Purchase:pi_7', name: 'Purchase', eventId: 'pi_7', valuePence: 2500 }]);
});

test('Batch 19: an automatic top-up is never a Purchase', async () => {
  const deps = fakeDeps();
  const recorded = withConversions(deps);
  await handleStripeEvent(ev('payment_intent.succeeded', { id: 'pi_auto', customer: 'cus_1', amount: 1000, amount_received: 1000, currency: 'gbp', metadata: { kind: 'topup', user_id: 'u1', amount_pence: '1000', auto: '1' } }), deps);
  assert.deepEqual(recorded, []);
  assert.equal(deps.calls.grantTopup?.length, 1, 'the credit is still granted');
});

test('Batch 19: a 100%-off first invoice is not a Subscribe; the first paid one is, excluding VAT, once', async () => {
  const deps = fakeDeps();
  const recorded = withConversions(deps);
  deps.setSub(subStarted('2026-10-01T09:00:00Z'));
  await handleStripeEvent(ev('invoice.paid', paidInvoice('in_free', 'subscription_create', 0, 0)), deps);
  assert.deepEqual(recorded, []);
  await handleStripeEvent(ev('invoice.paid', paidInvoice('in_paid', 'subscription_cycle', 1200, 1000)), deps);
  await handleStripeEvent(ev('invoice.paid', paidInvoice('in_paid', 'subscription_cycle', 1200, 1000)), deps);
  await handleStripeEvent(ev('invoice.paid', paidInvoice('in_next', 'subscription_cycle', 1200, 1000)), deps);
  assert.deepEqual(recorded, [{ key: 'Subscribe:u1', name: 'Subscribe', eventId: 'in_paid', valuePence: 1000 }]);
  assert.equal(deps.calls.grantPlanCycle?.length, 4, 'every invoice still grants its credit');
});

test('Batch 19: renewals of a subscription started before tracking began, and plan-change invoices, never fire', async () => {
  const deps = fakeDeps();
  const recorded = withConversions(deps);
  deps.setSub(subStarted('2026-06-01T09:00:00Z'));
  await handleStripeEvent(ev('invoice.paid', paidInvoice('in_old', 'subscription_cycle', 1200, 1000)), deps);
  deps.setSub(subStarted('2026-10-01T09:00:00Z'));
  await handleStripeEvent(ev('invoice.paid', paidInvoice('in_upgrade', 'subscription_update', 500, 400)), deps);
  assert.deepEqual(recorded, []);
});

test('Batch 19: a failure to record never fails the delivery', async () => {
  const deps = fakeDeps();
  deps.recordConversion = async () => {
    throw new Error('database down');
  };
  const r = await handleStripeEvent(ev('payment_intent.succeeded', { id: 'pi_8', customer: 'cus_1', amount: 1000, amount_received: 1000, currency: 'gbp', metadata: { kind: 'topup', user_id: 'u1', amount_pence: '1000' } }), deps);
  assert.equal(r.handled, true);
});

// ── Batch 20: the payments behind "Total paid" ──
// The fake stores rows as the database does: a payment once per id, a refund as the charge's largest cumulative amount.
function withPayments(deps: ReturnType<typeof fakeDeps>) {
  const payments = new Map<string, { kind: string; amountPence: number; userId: string; planCode: string | null }>();
  const refunds = new Map<string, { userId: string; amount: number; pi: string | null }>();
  deps.recordPayment = async (p) => {
    if (!payments.has(p.id)) payments.set(p.id, { kind: p.kind, amountPence: p.amountPence, userId: p.userId, planCode: p.planCode });
  };
  deps.recordRefund = async (r) => {
    const prev = refunds.get(r.chargeId);
    refunds.set(r.chargeId, { userId: r.userId, pi: r.paymentIntentId, amount: Math.max(prev?.amount ?? 0, r.amountRefundedPence) });
  };
  return { payments, refunds };
}

test('Batch 20: a Checkout top-up and its payment_intent.succeeded, each delivered twice, are one payment at the amount charged', async () => {
  const deps = fakeDeps();
  const { payments } = withPayments(deps);
  const session = { id: 'cs_1', mode: 'payment', client_reference_id: 'u1', customer: 'cus_1', payment_intent: 'pi_7', amount_total: 3000, currency: 'gbp', customer_details: { email: 'a@example.com' } };
  const pi = { id: 'pi_7', customer: 'cus_1', payment_method: 'pm_1', amount: 3000, amount_received: 3000, currency: 'gbp', metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500' } };
  deps.retrievePaymentIntent = async () => pi as unknown as Stripe.PaymentIntent;
  for (let i = 0; i < 2; i += 1) {
    await handleStripeEvent(ev('checkout.session.completed', session), deps);
    await handleStripeEvent(ev('payment_intent.succeeded', pi), deps);
  }
  assert.deepEqual([...payments.entries()], [['pi:pi_7', { kind: 'topup', amountPence: 3000, userId: 'u1', planCode: null }]]);
});

test('Batch 20: an automatic top-up is a payment too, marked automatic', async () => {
  const deps = fakeDeps();
  const { payments } = withPayments(deps);
  const pi = { id: 'pi_a', customer: 'cus_1', payment_method: 'pm_1', amount: 2000, amount_received: 2000, currency: 'gbp', metadata: { kind: 'topup', auto: '1', user_id: 'u1', amount_pence: '2000' } };
  await handleStripeEvent(ev('payment_intent.succeeded', pi), deps);
  assert.equal(payments.get('pi:pi_a')?.kind, 'auto_topup');
});

test('Batch 20: every paid invoice is a payment (a renewal, a plan change, an unknown price); a £0 one is not', async () => {
  const deps = fakeDeps();
  const { payments } = withPayments(deps);
  await handleStripeEvent(ev('invoice.paid', { ...paidInvoice('in_a', 'subscription_create', 2280, 1900) }), deps);
  await handleStripeEvent(ev('invoice.paid', { ...paidInvoice('in_a', 'subscription_create', 2280, 1900) }), deps);
  await handleStripeEvent(ev('invoice.paid', { ...paidInvoice('in_b', 'subscription_update', 500, 417) }), deps);
  await handleStripeEvent(ev('invoice.paid', { ...paidInvoice('in_c', 'subscription_cycle', 0, 0) }), deps);
  deps.setSub(null);
  await handleStripeEvent(ev('invoice.paid', { ...paidInvoice('in_d', 'subscription_cycle', 999, 999), lines: { data: [{ pricing: { price_details: { price: 'price_unknown' } } }] } }), deps);
  assert.deepEqual(
    [...payments.entries()].map(([k, v]) => [k, v.kind, v.amountPence, v.planCode]),
    [
      ['inv:in_a', 'subscription', 2280, 'starter'],
      ['inv:in_b', 'subscription', 500, 'starter'],
      ['inv:in_d', 'subscription', 999, null],
    ],
  );
});

test('Batch 20: refunds are recorded for any charge, as the cumulative amount, and the top-up clawback is unchanged', async () => {
  const deps = fakeDeps();
  const { refunds } = withPayments(deps);
  // A top-up's charge: the member comes from the payment's own metadata.
  await handleStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_9', customer: 'cus_1', amount_refunded: 1000 }), deps);
  await handleStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_9', customer: 'cus_1', amount_refunded: 2500 }), deps);
  // A redelivery of the first, arriving late, never lowers it.
  await handleStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_9', customer: 'cus_1', amount_refunded: 1000 }), deps);
  assert.deepEqual(refunds.get('ch_1'), { userId: 'u1', pi: 'pi_9', amount: 2500 });
  assert.deepEqual(deps.calls.refundTopup![0], ['u1', 'pi:pi_9', 1000, 'refunded']);
  // A subscription invoice's charge: no metadata, so the member is the customer.
  deps.retrievePaymentIntent = async (id) => ({ id, customer: 'cus_1', metadata: {} }) as unknown as Stripe.PaymentIntent;
  const r = await handleStripeEvent(ev('charge.refunded', { id: 'ch_2', payment_intent: 'pi_inv', customer: 'cus_1', amount_refunded: 1900 }), deps);
  assert.deepEqual(refunds.get('ch_2'), { userId: 'u1', pi: 'pi_inv', amount: 1900 });
  assert.equal(r.note, 'not a top-up');
});

test('Batch 20: bookkeeping that throws never fails the delivery', async () => {
  const deps = fakeDeps();
  deps.recordPayment = async () => {
    throw new Error('down');
  };
  deps.recordRefund = async () => {
    throw new Error('down');
  };
  const pi = { id: 'pi_9', customer: 'cus_1', payment_method: 'pm_9', amount: 2500, amount_received: 2500, metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500' } };
  assert.equal((await handleStripeEvent(ev('payment_intent.succeeded', pi), deps)).handled, true);
  assert.equal((await handleStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_9', amount_refunded: 100 }), deps)).handled, true);
});

// ── Batch 20: the £10 starter pack ──
const packPi = (over: Record<string, unknown> = {}) =>
  ({ id: 'pi_pack', status: 'succeeded', customer: 'cus_1', payment_method: 'pm_1', amount: 1000, amount_received: 1000, currency: 'gbp', metadata: { kind: 'starter_pack', user_id: 'u1', price_pence: '1000', credit_pence: '3000' }, ...over }) as unknown as Stripe.PaymentIntent;

function withPack(deps: ReturnType<typeof fakeDeps>, outcomes: Array<'granted' | 'already' | 'blocked' | 'ignored'> = ['granted', 'already']) {
  const settled: string[] = [];
  const granted: string[] = [];
  const clawed: Array<{ refundedPence: number; chargedPence: number; reason: string }> = [];
  deps.settleStarterPack = async (piId) => {
    settled.push(piId);
    return 'captured';
  };
  deps.grantStarterPack = async ({ paymentIntent }) => {
    granted.push(paymentIntent.id);
    return outcomes[Math.min(granted.length - 1, outcomes.length - 1)];
  };
  deps.clawbackStarterPack = async (c) => {
    clawed.push({ refundedPence: c.refundedPence, chargedPence: c.chargedPence, reason: c.reason });
  };
  return { settled, granted, clawed };
}

test('Batch 20: a pack Checkout saves the card and settles the authorised payment; it never grants a top-up', async () => {
  const deps = fakeDeps();
  const { settled } = withPack(deps);
  deps.retrievePaymentIntent = async () => packPi({ status: 'requires_capture' });
  const session = { id: 'cs_p', mode: 'payment', client_reference_id: 'u1', customer: 'cus_1', payment_intent: 'pi_pack', amount_total: 1000, metadata: { kind: 'starter_pack', user_id: 'u1' } };
  const r = await handleStripeEvent(ev('checkout.session.completed', session), deps);
  assert.equal(r.handled, true);
  assert.deepEqual(settled, ['pi_pack']);
  assert.equal(deps.calls.savePaymentMethod?.length, 1);
  assert.equal(deps.calls.grantTopup, undefined);
});

test('Batch 20: a captured pack is granted, logged, measured and booked once, however often it is delivered', async () => {
  const deps = fakeDeps();
  const { granted } = withPack(deps);
  const recorded = withConversions(deps);
  const { payments } = withPayments(deps);
  const seen = new Set<string>();
  deps.logActivity = async (a) => {
    if (a.dedupeKey && seen.has(a.dedupeKey)) return;
    if (a.dedupeKey) seen.add(a.dedupeKey);
    deps.activity.push(a);
  };
  for (let i = 0; i < 3; i += 1) await handleStripeEvent(ev('payment_intent.succeeded', packPi()), deps);
  assert.deepEqual(granted, ['pi_pack', 'pi_pack', 'pi_pack']);
  assert.deepEqual(deps.activity.map((a) => [a.kind, a.dedupeKey]), [['starter_pack', 'starter_pack:pi:pi_pack']]);
  assert.deepEqual(recorded, [{ key: 'Purchase:pi_pack', name: 'Purchase', eventId: 'pi_pack', valuePence: 1000 }]);
  assert.deepEqual([...payments.entries()].map(([k, v]) => [k, v.kind, v.amountPence]), [['pi:pi_pack', 'starter_pack', 1000]]);
  assert.equal(deps.calls.grantTopup, undefined);
});

test('Batch 20: a repeat that was charged anyway becomes a top-up and is logged as one', async () => {
  const deps = fakeDeps();
  withPack(deps, ['blocked']);
  const r = await handleStripeEvent(ev('payment_intent.succeeded', packPi()), deps);
  assert.equal(r.note, 'starter pack blocked');
  assert.deepEqual(deps.activity.map((a) => a.kind), ['topup']);
});

test('Batch 20: a pack payment the grant will not take (not captured) is not handled', async () => {
  const deps = fakeDeps();
  withPack(deps, ['ignored']);
  const r = await handleStripeEvent(ev('payment_intent.succeeded', packPi()), deps);
  assert.equal(r.handled, false);
  assert.equal(deps.activity.length, 0);
});

test('Batch 20: without the pack wired in, a pack payment is left alone, never granted as a top-up', async () => {
  const deps = fakeDeps();
  const r = await handleStripeEvent(ev('payment_intent.succeeded', packPi()), deps);
  assert.equal(r.handled, false);
  assert.equal(deps.calls.grantTopup, undefined);
});

test("Batch 20: refunding or disputing a pack claws its credit back, and never touches the top-up clawback", async () => {
  const deps = fakeDeps();
  const { clawed } = withPack(deps);
  deps.retrievePaymentIntent = async () => packPi();
  const r = await handleStripeEvent(ev('charge.refunded', { id: 'ch_p', payment_intent: 'pi_pack', customer: 'cus_1', amount: 1000, amount_refunded: 500 }), deps);
  assert.equal(r.note, 'starter pack credit clawed back');
  await handleStripeEvent(ev('charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_pack', amount: 1000 }), deps);
  assert.deepEqual(clawed, [
    { refundedPence: 500, chargedPence: 1000, reason: 'refunded' },
    { refundedPence: 1000, chargedPence: 1000, reason: 'disputed' },
  ]);
  assert.equal(deps.calls.refundTopup, undefined);
});

test('Batch 20: an invoice payment carries its PaymentIntent (from the invoice, else asked of Stripe), so its refunds can be matched', async () => {
  const deps = fakeDeps();
  const seen: Array<[string, string | null]> = [];
  deps.recordPayment = async (p) => {
    seen.push([p.id, p.paymentIntentId]);
  };
  deps.invoicePaymentIntent = async (invoiceId) => (invoiceId === 'in_ask' ? 'pi_asked' : null);
  await handleStripeEvent(ev('invoice.paid', { ...paidInvoice('in_has', 'subscription_cycle', 1900, 1900), payments: { data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_on_invoice' } }] } }), deps);
  await handleStripeEvent(ev('invoice.paid', paidInvoice('in_ask', 'subscription_cycle', 1900, 1900)), deps);
  deps.invoicePaymentIntent = async () => {
    throw new Error('Stripe down');
  };
  const r = await handleStripeEvent(ev('invoice.paid', paidInvoice('in_down', 'subscription_cycle', 1900, 1900)), deps);
  assert.equal(r.handled, true);
  assert.deepEqual(seen, [
    ['inv:in_has', 'pi_on_invoice'],
    ['inv:in_ask', 'pi_asked'],
    ['inv:in_down', null],
  ]);
});

test('Batch 20: a pack authorised or cancelled is settled (captured, or its claim let go); other payments are left alone', async () => {
  const deps = fakeDeps();
  const { settled } = withPack(deps);
  assert.equal((await handleStripeEvent(ev('payment_intent.amount_capturable_updated', packPi({ status: 'requires_capture' })), deps)).note, 'starter pack captured');
  assert.equal((await handleStripeEvent(ev('payment_intent.canceled', packPi({ status: 'canceled' })), deps)).handled, true);
  const topup = { id: 'pi_t', status: 'canceled', metadata: { kind: 'topup', user_id: 'u1' } };
  assert.equal((await handleStripeEvent(ev('payment_intent.canceled', topup), deps)).handled, false);
  assert.deepEqual(settled, ['pi_pack', 'pi_pack']);
});

test('Batch 20: a pack hold released before capture is reported as refunded; nothing is clawed back or taken off Total paid', async () => {
  const deps = fakeDeps();
  const { clawed } = withPack(deps);
  const { refunds } = withPayments(deps);
  deps.retrievePaymentIntent = async () => packPi({ status: 'canceled' });
  const r = await handleStripeEvent(ev('charge.refunded', { id: 'ch_hold', payment_intent: 'pi_pack', customer: 'cus_1', captured: false, amount: 1000, amount_refunded: 1000 }), deps);
  assert.equal(r.note, 'starter pack authorisation released (never charged)');
  assert.deepEqual(clawed, []);
  assert.equal(refunds.size, 0);
  assert.equal(deps.calls.refundTopup, undefined);
});

test('Batch 20: a refund whose payment cannot be read fails the delivery, so Stripe sends it again and no clawback is lost', async () => {
  const deps = fakeDeps();
  const { clawed } = withPack(deps);
  deps.retrievePaymentIntentStrict = async () => {
    throw new Error('Stripe down');
  };
  await assert.rejects(handleStripeEvent(ev('charge.refunded', { id: 'ch_p', payment_intent: 'pi_pack', customer: 'cus_1', captured: true, amount: 1000, amount_refunded: 1000 }), deps), /Stripe down/);
  deps.retrievePaymentIntentStrict = async () => packPi();
  await handleStripeEvent(ev('charge.refunded', { id: 'ch_p', payment_intent: 'pi_pack', customer: 'cus_1', captured: true, amount: 1000, amount_refunded: 1000 }), deps);
  assert.deepEqual(clawed, [{ refundedPence: 1000, chargedPence: 1000, reason: 'refunded' }]);
  // No such payment (not ours): not a pack, and the delivery goes on as before.
  deps.retrievePaymentIntentStrict = async () => null;
  assert.equal((await handleStripeEvent(ev('charge.refunded', { id: 'ch_x', payment_intent: 'pi_gone', customer: 'cus_1', captured: true, amount: 500, amount_refunded: 500 }), deps)).handled, true);
});

// ── Batch 21 ──

test('invoice.paid with no linked subscription or customer is matched by the invoice email (B19)', async () => {
  const deps = fakeDeps();
  const invoice = { id: 'in_19', customer: 'cus_other', customer_email: 'a@example.com', billing_reason: 'subscription_create', parent: { subscription_details: { subscription: 'sub_new' } }, lines: { data: [{ period: { end: 1_800_000_000 }, pricing: { price_details: { price: 'price_starter' } } }] } };
  deps.setSub(null);
  const r = await handleStripeEvent(ev('invoice.paid', invoice), deps);
  assert.equal(r.handled, true);
  assert.equal(deps.calls.grantPlanCycle![0][0], 'u1');
});

test('a subscription that is still incomplete is neither ended nor mirrored (B42)', async () => {
  const deps = fakeDeps();
  const r = await handleStripeEvent(ev('customer.subscription.updated', { id: 'sub_1', status: 'incomplete', customer: 'cus_1', cancel_at_period_end: false, items: { data: [{ price: { id: 'price_starter' }, current_period_end: 1_800_000_000 }] } }), deps);
  assert.equal(r.handled, true);
  assert.equal(deps.calls.expirePlanGrants, undefined);
  assert.equal(deps.calls.updateProfile, undefined);
  assert.deepEqual(deps.events, []);
});

test('a failed one-off invoice does not mark the member past due (B43)', async () => {
  const deps = fakeDeps();
  const r = await handleStripeEvent(ev('invoice.payment_failed', { id: 'in_43', customer: 'cus_1', parent: null }), deps);
  assert.equal(r.handled, false);
  assert.equal(deps.calls.updateProfile, undefined);
  assert.equal(deps.calls.paymentFailedEmail, undefined);
});

test('a top-up checkout completed before the money arrived grants nothing yet (B15)', async () => {
  const deps = fakeDeps();
  const session = { id: 'cs_15', mode: 'payment', payment_status: 'unpaid', client_reference_id: 'u1', customer: 'cus_1', payment_intent: 'pi_15', amount_total: 2500, currency: 'gbp', metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500' } };
  const r = await handleStripeEvent(ev('checkout.session.completed', session), deps);
  assert.equal(r.handled, true);
  assert.ok(!('grantTopup' in deps.calls), 'nothing granted while unpaid');
  const paid = await handleStripeEvent(ev('checkout.session.completed', { ...session, payment_status: 'paid' }), deps);
  assert.equal(paid.handled, true);
  assert.equal((deps.calls['grantTopup'] ?? []).length, 1);
});

test('a refund of a VAT-inclusive charge claws back the same share of the ex-VAT credit (B18)', async () => {
  const deps = fakeDeps();
  deps.retrievePaymentIntent = async (id) => ({ id, amount: 3000, amount_received: 3000, currency: 'gbp', metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500' } }) as unknown as Stripe.PaymentIntent;
  await handleStripeEvent(ev('charge.refunded', { id: 'ch_18', payment_intent: 'pi_18', amount: 3000, amount_refunded: 1500, refunded: false }), deps);
  const [userId, sourceRef, amount, reason] = deps.calls.refundTopup![0];
  assert.equal(userId, 'u1');
  assert.equal(sourceRef, 'pi:pi_18');
  assert.equal(amount, 1250);
  assert.equal(reason, 'refunded');
});

test('a dispute won gives the credit back; one lost does not (B17)', async () => {
  const deps = fakeDeps();
  deps.retrievePaymentIntentStrict = async (id) => ({ id, amount: 2500, metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500' } }) as unknown as Stripe.PaymentIntent;
  const won = await handleStripeEvent(ev('charge.dispute.closed', { id: 'dp_1', status: 'won', payment_intent: 'pi_17', amount: 2500 }), deps);
  assert.equal(won.handled, true);
  assert.deepEqual(deps.calls.restoreDisputedCredit![0], ['u1', 'pi_17']);
  const lost = await handleStripeEvent(ev('charge.dispute.closed', { id: 'dp_2', status: 'lost', payment_intent: 'pi_17', amount: 2500 }), deps);
  assert.equal(lost.handled, false);
  assert.equal(deps.calls.restoreDisputedCredit!.length, 1);
});

test('Batch 23: the auto top-up link\'s checkout switches auto top-up on (only if off) and records it once', async () => {
  const deps = fakeDeps();
  const switched: unknown[][] = [];
  let off = true;
  deps.enableAutoTopup = async (...a) => {
    switched.push(a);
    const was = off;
    off = false;
    return was;
  };
  deps.retrievePaymentIntent = async (id) => ({ id, payment_method: 'pm_1', customer: 'cus_1', amount: 2500, amount_received: 2500, metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500', auto_topup_on: '1', auto_topup_threshold_pence: '500' } }) as unknown as Stripe.PaymentIntent;
  const session = { id: 'cs_9', mode: 'payment', client_reference_id: 'u1', customer: 'cus_1', payment_intent: 'pi_9', amount_total: 2500, payment_status: 'paid', customer_details: { email: 'a@example.com' } };
  await handleStripeEvent(ev('checkout.session.completed', session), deps);
  assert.deepEqual(switched[0], ['u1', 2500, 500]);
  assert.equal(deps.activity.filter((a) => a.kind === 'auto_topup_settings').length, 1);
  assert.equal(deps.activity.find((a) => a.kind === 'auto_topup_settings')?.source, 'sms_link');
  // The payment_intent.succeeded for the same payment: already on, nothing more recorded.
  await handleStripeEvent(ev('payment_intent.succeeded', { id: 'pi_9', customer: 'cus_1', payment_method: 'pm_1', amount: 2500, amount_received: 2500, currency: 'gbp', metadata: { kind: 'topup', user_id: 'u1', amount_pence: '2500', auto_topup_on: '1', auto_topup_threshold_pence: '500' } }), deps);
  assert.equal(deps.activity.filter((a) => a.kind === 'auto_topup_settings').length, 1);
});

test('Batch 23: an ordinary top-up never switches auto top-up on', async () => {
  const deps = fakeDeps();
  let called = false;
  deps.enableAutoTopup = async () => {
    called = true;
    return true;
  };
  await handleStripeEvent(ev('checkout.session.completed', { id: 'cs_1', mode: 'payment', client_reference_id: 'u1', customer: 'cus_1', payment_intent: 'pi_7', amount_total: 2500, customer_details: { email: 'a@example.com' } }), deps);
  assert.equal(called, false);
});
