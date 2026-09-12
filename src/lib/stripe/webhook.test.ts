import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { handleStripeEvent, type WebhookDeps } from './webhook.ts';

const env = { STRIPE_PRICE_STARTER: 'price_starter', STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_PRO_ANNUAL: 'price_annual' };

function fakeDeps() {
  const calls: Record<string, unknown[][]> = {};
  const rec = (name: string) => (...args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const user = { id: 'u1', email: 'a@example.com', plan_code: 'starter' as string | null };
  const sub = (priceId: string, status = 'active', cancel = false): Stripe.Subscription =>
    ({ id: 'sub_1', status, cancel_at_period_end: cancel, customer: 'cus_1', items: { data: [{ price: { id: priceId }, current_period_end: 1_800_000_000 }] } }) as unknown as Stripe.Subscription;
  let subscription: Stripe.Subscription | null = sub('price_starter');
  const deps: WebhookDeps & { calls: typeof calls; setSub: (s: Stripe.Subscription | null) => void } = {
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
