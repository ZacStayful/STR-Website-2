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

export interface WebhookDeps {
  env?: Env;
  findUserBySubscription(subscriptionId: string): Promise<{ id: string; email: string | null; plan_code: string | null } | null>;
  findUserByCustomer(customerId: string): Promise<{ id: string; email: string | null; plan_code: string | null } | null>;
  findUserByEmail(email: string): Promise<{ id: string; email: string | null; plan_code: string | null } | null>;
  findUserById(userId: string): Promise<{ id: string; email: string | null; plan_code: string | null } | null>;
  updateProfile(userId: string, patch: Record<string, unknown>): Promise<void>;
  grantPlanCycle(userId: string, planCode: string, sourceRef: string, periodEnd: Date | null, email: string | null): Promise<void>;
  grantUpgradeDifference(userId: string, fromPlanCode: string | null, toPlanCode: string, sourceRef: string, periodEnd: Date | null): Promise<void>;
  grantTopup(userId: string, amountPence: number, sourceRef: string, email: string | null): Promise<boolean>;
  expirePlanGrants(userId: string, reason: string): Promise<number>;
  savePaymentMethod(userId: string, customerId: string | null, paymentMethodId: string): Promise<void>;
  retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent | null>;
  retrieveSubscription(id: string): Promise<Stripe.Subscription | null>;
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
          const sub = await deps.retrieveSubscription(subId);
          const code = planForPriceId(priceIdOf(sub), env);
          if (code) patch.plan_code = code;
          if (sub) {
            patch.stripe_price_id = priceIdOf(sub);
            patch.current_period_end = periodEndOf(sub)?.toISOString() ?? null;
            patch.cancel_at_period_end = Boolean(sub.cancel_at_period_end);
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
        current_period_end: periodEnd?.toISOString() ?? null,
        cancel_at_period_end: Boolean(sub?.cancel_at_period_end),
        plan: 'pro',
      };
      if (id(invoice.customer)) patch.stripe_customer_id = id(invoice.customer);
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

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      let user = await deps.findUserBySubscription(sub.id);
      if (!user && id(sub.customer)) user = await deps.findUserByCustomer(id(sub.customer)!);
      if (!user) return { handled: false, note: 'no user for subscription' };
      const ended = event.type === 'customer.subscription.deleted' || ['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status);
      const priceId = priceIdOf(sub);
      const planCode = planForPriceId(priceId, env);
      const patch: Record<string, unknown> = {
        stripe_subscription_status: sub.status,
        cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        current_period_end: periodEndOf(sub)?.toISOString() ?? null,
      };
      if (ended) {
        Object.assign(patch, { plan: 'free', plan_code: null, stripe_price_id: null });
        await deps.updateProfile(user.id, patch);
        await deps.expirePlanGrants(user.id, 'subscription_ended');
        if (user.email) await deps.onSubscriptionCancelled(user.email);
        return { handled: true, note: 'subscription ended; plan credit expired' };
      }
      if (planCode) Object.assign(patch, { plan_code: planCode, stripe_price_id: priceId, plan: 'pro' });
      await deps.updateProfile(user.id, patch);
      return { handled: true };
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
