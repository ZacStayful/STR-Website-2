/**
 * Stripe event → credit ledger. Pure-ish: everything that touches the
 * database, Stripe or email goes through `deps`, so the handler is unit
 * tested with fakes (webhook.test.ts) and the route wires the real thing.
 *
 * API version 2026-04-22.dahlia shapes: an invoice's subscription lives at
 * invoice.parent.subscription_details.subscription, a subscription's period
 * on its items, and a line's price at line.pricing.price_details.price.
 */

import type Stripe from 'stripe';
import { planForPriceId, topupPenceForPriceId, type Env } from './prices.ts';
import { subscriptionStateFromStripe } from '../subscription.ts';

export interface WebhookUser {
  id: string;
  email: string | null;
  plan_code: string | null;
  /** 'manual' marks a plan granted by hand that a stray Stripe event must not revoke. */
  plan_source?: string | null;
}

export interface WebhookDeps {
  env?: Env;
  findUserBySubscription(subscriptionId: string): Promise<WebhookUser | null>;
  findUserByCustomer(customerId: string): Promise<WebhookUser | null>;
  findUserByEmail(email: string): Promise<WebhookUser | null>;
  findUserById(userId: string): Promise<WebhookUser | null>;
  updateProfile(userId: string, patch: Record<string, unknown>): Promise<void>;
  grantPlanCycle(userId: string, planCode: string, sourceRef: string, periodEnd: Date | null, email: string | null): Promise<void>;
  grantUpgradeDifference(userId: string, fromPlanCode: string | null, toPlanCode: string, sourceRef: string, periodEnd: Date | null): Promise<void>;
  grantTopup(userId: string, amountPence: number, sourceRef: string, email: string | null): Promise<boolean>;
  expirePlanGrants(userId: string, reason: string): Promise<number>;
  savePaymentMethod(userId: string, customerId: string | null, paymentMethodId: string): Promise<void>;
  retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent | null>;
  retrieveSubscription(id: string): Promise<Stripe.Subscription | null>;
  /** Every subscription the customer holds; used to spot a late delete for a superseded plan. */
  listSubscriptions?(customerId: string): Promise<Stripe.Subscription[]>;
  refundTopup?(userId: string, sourceRef: string, amountPence: number, reason: string): Promise<void>;
  onSubscriptionStarted(email: string): Promise<void>;
  onSubscriptionCancelled(email: string): Promise<void>;
  paymentFailedEmail(email: string, planName: string | null): Promise<unknown>;
  cardNeedsUpdateEmail(email: string): Promise<unknown>;
  log?: (msg: string) => void;
}

export interface HandleResult {
  handled: boolean;
  note?: string;
}

function id(x: string | { id: string } | null | undefined): string | null {
  if (!x) return null;
  return typeof x === 'string' ? x : x.id;
}

function periodEndOf(sub: Stripe.Subscription | null): Date | null {
  const secs = sub?.items?.data?.[0]?.current_period_end;
  return secs ? new Date(secs * 1000) : null;
}

function priceIdOf(sub: Stripe.Subscription | null): string | null {
  return sub?.items?.data?.[0]?.price?.id ?? null;
}

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

function isoFromUnix(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  const d = new Date(seconds * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The self-serve pause / cancel columns, re-derived in full from the
 * subscription so a replayed event writes the same row and an auto-resume
 * (which arrives as `pause_collection: null`) clears the window by itself.
 * Shared with the /account server actions via subscriptionStateFromStripe.
 */
function subscriptionColumns(sub: Stripe.Subscription): Record<string, unknown> {
  const state = subscriptionStateFromStripe(sub);
  const patch: Record<string, unknown> = {
    subscription_paused_from: state.pausedFrom,
    subscription_paused_until: state.pausedUntil,
    subscription_cancel_at: state.cancelAt,
    subscription_current_period_end: state.currentPeriodEnd,
  };
  if (!state.cancelAt) {
    // The cancellation was undone, or the subscription is gone. Either way the
    // captured reason no longer describes anything.
    patch.cancel_reason = null;
    patch.cancel_reason_comment = null;
    patch.cancel_reason_at = null;
  }
  return patch;
}

export async function handleStripeEvent(event: Stripe.Event, deps: WebhookDeps): Promise<HandleResult> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((m: string) => console.log(`[stripe/webhook] ${m}`));

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = id(session.customer);
      const email = session.customer_details?.email ?? session.customer_email ?? null;
      let user = session.client_reference_id ? await deps.findUserById(session.client_reference_id) : null;
      if (!user && customerId) user = await deps.findUserByCustomer(customerId);
      if (!user && email) user = await deps.findUserByEmail(email);
      if (!user) return { handled: false, note: 'no user for checkout session' };

      const patch: Record<string, unknown> = {};
      if (customerId) patch.stripe_customer_id = customerId;
      if (session.consent?.terms_of_service === 'accepted') patch.terms_accepted_at = new Date().toISOString();

      if (session.mode === 'subscription') {
        const subId = id(session.subscription);
        if (subId) {
          patch.stripe_subscription_id = subId;
          patch.stripe_subscription_status = 'active';
          patch.plan = 'pro';
          patch.subscription_ended_at = null;
          if (user.plan_source !== 'manual') patch.plan_source = 'stripe';
          const sub = await deps.retrieveSubscription(subId);
          const code = planForPriceId(priceIdOf(sub), env);
          if (code) patch.plan_code = code;
          if (sub) {
            patch.stripe_subscription_status = sub.status;
            patch.stripe_price_id = priceIdOf(sub);
            patch.current_period_end = periodEndOf(sub)?.toISOString() ?? null;
            patch.cancel_at_period_end = Boolean(sub.cancel_at_period_end);
            patch.subscription_started_at = isoFromUnix(sub.start_date) ?? new Date().toISOString();
            Object.assign(patch, subscriptionColumns(sub));
          } else {
            patch.subscription_started_at = new Date().toISOString();
          }
        }
        await deps.updateProfile(user.id, patch);
        if (user.email ?? email) await deps.onSubscriptionStarted((user.email ?? email)!);
        return { handled: true, note: 'subscription checkout recorded; credit follows invoice.paid' };
      }

      // One-off top-up through Checkout: save the card, grant the credit.
      await deps.updateProfile(user.id, patch);
      const piId = id(session.payment_intent);
      if (piId) {
        const pi = await deps.retrievePaymentIntent(piId);
        const pm = id(pi?.payment_method);
        if (pm) await deps.savePaymentMethod(user.id, customerId, pm);
        const amount = Number(pi?.metadata?.amount_pence ?? session.amount_total ?? 0) || Number(session.amount_total ?? 0);
        if (pi?.metadata?.kind === 'topup' || session.metadata?.kind === 'topup') {
          if (amount > 0) await deps.grantTopup(user.id, amount, `pi:${piId}`, user.email ?? email);
        }
      }
      return { handled: true };
    }

    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.kind !== 'topup') return { handled: false, note: 'not a top-up' };
      const userId = pi.metadata.user_id;
      const user = userId ? await deps.findUserById(userId) : id(pi.customer) ? await deps.findUserByCustomer(id(pi.customer)!) : null;
      if (!user) return { handled: false, note: 'no user for payment intent' };
      const pm = id(pi.payment_method);
      if (pm) await deps.savePaymentMethod(user.id, id(pi.customer), pm);
      const amount = Number(pi.metadata.amount_pence ?? pi.amount_received ?? pi.amount) || pi.amount_received || pi.amount;
      const granted = await deps.grantTopup(user.id, amount, `pi:${pi.id}`, user.email);
      return { handled: true, note: granted ? 'top-up granted' : 'already granted' };
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoice.parent?.subscription_details?.subscription ? id(invoice.parent.subscription_details.subscription) : null;
      if (!subId) return { handled: false, note: 'invoice without subscription' };
      let user = await deps.findUserBySubscription(subId);
      if (!user && id(invoice.customer)) user = await deps.findUserByCustomer(id(invoice.customer)!);
      if (!user) return { handled: false, note: 'no user for invoice' };
      const sub = await deps.retrieveSubscription(subId);
      const linePrice = invoice.lines?.data?.[0]?.pricing?.price_details?.price;
      const priceId = priceIdOf(sub) ?? (typeof linePrice === 'string' ? linePrice : (linePrice?.id ?? null));
      const planCode = planForPriceId(priceId, env);
      if (!planCode) {
        log(`invoice ${invoice.id}: price ${priceId} is not a known plan`);
        return { handled: false, note: 'unknown price' };
      }
      const lineEnd = invoice.lines?.data?.[0]?.period?.end;
      const periodEnd = periodEndOf(sub) ?? (lineEnd ? new Date(lineEnd * 1000) : null);
      const patch: Record<string, unknown> = {
        stripe_subscription_id: subId,
        stripe_subscription_status: sub?.status ?? 'active',
        stripe_price_id: priceId,
        plan_code: planCode,
        current_period_end: periodEnd?.toISOString() ?? null,
        cancel_at_period_end: Boolean(sub?.cancel_at_period_end),
        plan: 'pro',
        subscription_ended_at: null,
      };
      if (user.plan_source !== 'manual') patch.plan_source = 'stripe';
      if (id(invoice.customer)) patch.stripe_customer_id = id(invoice.customer);
      if (sub) {
        patch.subscription_started_at = isoFromUnix(sub.start_date);
        Object.assign(patch, subscriptionColumns(sub));
      }
      await deps.updateProfile(user.id, patch);

      const reason = invoice.billing_reason;
      if (reason === 'subscription_create' || reason === 'subscription_cycle' || reason === 'manual' || reason === null) {
        if (planCode === 'pro_annual') {
          // Annual: the first month now; the sweep cron grants the rest month by month.
          const start = new Date();
          const slotEnd = new Date(start);
          slotEnd.setUTCMonth(start.getUTCMonth() + 1);
          await deps.grantPlanCycle(user.id, planCode, `annual:${subId}:${start.toISOString().slice(0, 7)}`, periodEnd && slotEnd > periodEnd ? periodEnd : slotEnd, user.email);
        } else {
          await deps.grantPlanCycle(user.id, planCode, `inv:${invoice.id}`, periodEnd, user.email);
        }
        return { handled: true, note: `plan cycle granted (${reason ?? 'unspecified'})` };
      }
      if (reason === 'subscription_update') {
        await deps.grantUpgradeDifference(user.id, user.plan_code, planCode, `inv:${invoice.id}`, periodEnd);
        return { handled: true, note: 'upgrade difference granted' };
      }
      return { handled: false, note: `billing_reason ${reason} ignored` };
    }

    // `created` matters for subscriptions set up by hand in the Stripe
    // dashboard: there is no Checkout Session for those, so this is the only
    // event that can link them to a profile (credit still follows invoice.paid).
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = id(sub.customer);
      let user = await deps.findUserBySubscription(sub.id);
      if (!user && customerId) user = await deps.findUserByCustomer(customerId);
      if (!user) return { handled: false, note: 'no user for subscription' };
      const ended = event.type === 'customer.subscription.deleted' || !LIVE_STATUSES.has(sub.status);

      // Don't let a dead subscription end the plan when the customer still has
      // a live one. Switching plan (monthly → annual) cancels the old
      // subscription and creates a new one, and Stripe does not guarantee
      // event order — a late `sub_old.deleted` would otherwise expire the
      // credit a customer is paying for on sub_new (whose own events carry
      // the right state).
      if (ended && customerId && deps.listSubscriptions) {
        const live = (await deps.listSubscriptions(customerId)).find((s) => s.id !== sub.id && LIVE_STATUSES.has(s.status));
        if (live) return { handled: false, note: `ignoring ${sub.id} (${sub.status}); customer still has live subscription ${live.id}` };
      }

      const priceId = priceIdOf(sub);
      const planCode = planForPriceId(priceId, env);
      const manual = user.plan_source === 'manual';
      const patch: Record<string, unknown> = {
        stripe_subscription_id: sub.id,
        stripe_subscription_status: sub.status,
        cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        current_period_end: periodEndOf(sub)?.toISOString() ?? null,
        ...subscriptionColumns(sub),
      };
      if (customerId) patch.stripe_customer_id = customerId;
      if (ended) {
        // A plan granted by hand is a deliberate decision that outranks Stripe;
        // record what Stripe said but keep the override.
        if (!manual) Object.assign(patch, { plan: 'free', plan_code: null, stripe_price_id: null, plan_source: 'stripe' });
        patch.subscription_ended_at = new Date().toISOString();
        await deps.updateProfile(user.id, patch);
        await deps.expirePlanGrants(user.id, 'subscription_ended');
        if (user.email) await deps.onSubscriptionCancelled(user.email);
        return { handled: true, note: 'subscription ended; plan credit expired' };
      }
      patch.subscription_ended_at = null;
      patch.subscription_started_at = isoFromUnix(sub.start_date);
      if (!manual) patch.plan_source = 'stripe';
      if (planCode) Object.assign(patch, { plan_code: planCode, stripe_price_id: priceId, plan: 'pro' });
      await deps.updateProfile(user.id, patch);
      return { handled: true, note: sub.pause_collection ? 'subscription state mirrored (paused)' : 'subscription state mirrored' };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoice.parent?.subscription_details?.subscription ? id(invoice.parent.subscription_details.subscription) : null;
      let user = subId ? await deps.findUserBySubscription(subId) : null;
      if (!user && id(invoice.customer)) user = await deps.findUserByCustomer(id(invoice.customer)!);
      if (!user) return { handled: false, note: 'no user for failed invoice' };
      await deps.updateProfile(user.id, { stripe_subscription_status: 'past_due' });
      if (user.email) await deps.paymentFailedEmail(user.email, user.plan_code);
      return { handled: true, note: 'marked past_due' };
    }

    case 'payment_method.attached': {
      const pm = event.data.object as Stripe.PaymentMethod;
      const customerId = id(pm.customer);
      if (!customerId) return { handled: false };
      const user = await deps.findUserByCustomer(customerId);
      if (!user) return { handled: false, note: 'no user for customer' };
      await deps.savePaymentMethod(user.id, customerId, pm.id);
      return { handled: true };
    }

    case 'charge.refunded':
    case 'charge.dispute.created': {
      if (!deps.refundTopup) return { handled: false, note: 'no clawback configured' };
      const obj = event.data.object as Stripe.Charge | Stripe.Dispute;
      const charge = event.type === 'charge.refunded' ? (obj as Stripe.Charge) : null;
      const piId = charge ? id(charge.payment_intent) : id((obj as Stripe.Dispute).payment_intent);
      if (!piId) return { handled: false, note: 'no payment intent' };
      const pi = await deps.retrievePaymentIntent(piId);
      if (pi?.metadata?.kind !== 'topup' || !pi.metadata.user_id) return { handled: false, note: 'not a top-up' };
      const amount = charge ? charge.amount_refunded : (obj as Stripe.Dispute).amount;
      await deps.refundTopup(pi.metadata.user_id, `pi:${piId}`, amount, event.type === 'charge.refunded' ? 'refunded' : 'disputed');
      return { handled: true, note: 'top-up clawed back' };
    }

    default:
      return { handled: false, note: `ignored ${event.type}` };
  }
}

/** Human label for the plan price a subscription is on (used in emails). */
export function planCodeForSubscription(sub: Stripe.Subscription | null, env: Env = process.env): string | null {
  return planForPriceId(priceIdOf(sub), env);
}

export { topupPenceForPriceId };
