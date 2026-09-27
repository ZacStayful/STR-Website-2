/**
 * Which billing group a member is in at a given moment, for the weekly-active
 * figures. Every member is in exactly one:
 *
 *   paused      their subscription is inside a pause window
 *   cancelled   their subscription has ended and they have not paid since
 *   paying      they have paid real money at least once: a Stripe
 *               subscription that charged, or a card top-up (manual or
 *               automatic), not refunded
 *   never_paid  everyone else: a trial that has not charged, a plan granted
 *               by hand, welcome credit, promo codes
 *
 * Checked in that order. A cancellation that is booked but not yet reached
 * is still paying until the subscription ends; a top-up after a
 * cancellation makes them paying again.
 *
 * "Paid in the last 90 days" (the Active paying figure): a payment in the 90
 * days up to the moment, or a subscription that is live then (not paused,
 * not ended), monthly or annual alike.
 *
 * Payments come from credit_grants (top-ups and paid invoices, refunds
 * already removed by the database). Subscriptions come from
 * subscription_events where they exist, and from the profile's start, end
 * and pause dates otherwise. If Stripe's invoices never reached us, a
 * subscription Stripe reports as active or past due still counts as paid
 * from its start.
 *
 * Pure: no network, no database, no server-only.
 */

export type BillingCategory = 'paying' | 'paused' | 'cancelled' | 'never_paid';

export const BILLING_CATEGORIES: readonly BillingCategory[] = ['paying', 'paused', 'cancelled', 'never_paid'];

export interface BillingFacts {
  createdAt: string | null;
  /** 'manual' marks a plan set up by hand, which is not a paid subscription. */
  planSource: string | null;
  /** Stripe's subscription status now. */
  status: string | null;
  subStarted: string | null;
  subEnded: string | null;
  pausedFrom: string | null;
  pausedUntil: string | null;
  /**
   * Real-money payments: the first ever, the latest before the window the
   * caller asked about, and every one inside it.
   */
  payments: { first: string | null; before: string | null; list: readonly string[] };
  /** subscription_events of kind started, ended, paused and resumed. */
  events: readonly { k: string; at: string }[];
}

interface Span {
  from: number;
  to: number | null;
}

const DAY_MS = 86_400_000;
export const PAID_RECENTLY_DAYS = 90;
/** Stripe statuses that mean the subscription has charged at least once. */
const CHARGED = new Set(['active', 'past_due']);

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function covers(span: Span, t: number): boolean {
  return span.from <= t && (span.to === null || t < span.to);
}

/** The member's subscriptions, oldest first. */
export function subscriptionSpans(b: BillingFacts): Span[] {
  if (b.planSource === 'manual') return [];
  const events = b.events
    .map((e) => ({ k: e.k, t: time(e.at) }))
    .filter((e): e is { k: string; t: number } => e.t !== null && (e.k === 'started' || e.k === 'ended'))
    .sort((a, c) => a.t - c.t);
  const spans: Span[] = [];
  let open: number | null = null;
  for (const e of events) {
    // Stripe reports a new subscription twice (checkout, then the subscription
    // itself): a start while one is open is the same subscription.
    if (e.k === 'started') open ??= e.t;
    else if (open !== null) {
      spans.push({ from: open, to: e.t });
      open = null;
    }
  }
  if (open !== null) spans.push({ from: open, to: null });

  // The profile holds the latest subscription, which the events may have
  // missed (history before the log, a webhook that never arrived).
  const started = time(b.subStarted) ?? (b.status && CHARGED.has(b.status) ? time(b.createdAt) : null);
  const ended = time(b.subEnded);
  if (started !== null) {
    const last = spans[spans.length - 1];
    if (!last || started > (last.to ?? last.from)) {
      spans.push({ from: started, to: ended !== null && ended >= started ? ended : null });
    } else if (last.to === null && ended !== null && ended >= last.from) {
      last.to = ended;
    }
  }
  return spans;
}

/** Pause windows: from the events, and the profile's current or booked one. */
export function pauseSpans(b: BillingFacts): Span[] {
  const events = b.events
    .map((e) => ({ k: e.k, t: time(e.at) }))
    .filter((e): e is { k: string; t: number } => e.t !== null && (e.k === 'paused' || e.k === 'resumed'))
    .sort((a, c) => a.t - c.t);
  const spans: Span[] = [];
  let open: number | null = null;
  for (const e of events) {
    if (e.k === 'paused') open ??= e.t;
    else if (open !== null) {
      spans.push({ from: open, to: e.t });
      open = null;
    }
  }
  // An open pause from the events is bounded by the profile's window when it has one.
  const from = time(b.pausedFrom);
  const until = time(b.pausedUntil);
  if (open !== null) spans.push({ from: open, to: until !== null && until > open ? until : null });
  // As src/lib/access.ts: a window missing either end is not a pause.
  if (from !== null && until !== null && until > from) spans.push({ from, to: until });
  return spans;
}

function latestPaymentAtOrBefore(b: BillingFacts, t: number): number | null {
  let best: number | null = null;
  const consider = (iso: string | null) => {
    const x = time(iso);
    if (x !== null && x <= t && (best === null || x > best)) best = x;
  };
  consider(b.payments.before);
  for (const iso of b.payments.list) consider(iso);
  return best;
}

export interface BillingView {
  category: BillingCategory;
  /** Paid in the 90 days up to the moment, or on a live subscription then. */
  paidRecently: boolean;
}

/** The member's billing group and recent payment at `at`. */
export function billingAt(b: BillingFacts, at: Date): BillingView {
  const t = at.getTime();
  const subs = subscriptionSpans(b);
  const live = subs.find((s) => covers(s, t)) ?? null;
  const paused = live !== null && pauseSpans(b).some((p) => covers(p, t));
  const latestPayment = latestPaymentAtOrBefore(b, t);
  const paidRecently = (live !== null && !paused) || (latestPayment !== null && latestPayment > t - PAID_RECENTLY_DAYS * DAY_MS);

  if (paused) return { category: 'paused', paidRecently };

  if (live === null) {
    const ends = subs.map((s) => s.to).filter((x): x is number => x !== null && x <= t);
    if (ends.length > 0) {
      const lastEnd = Math.max(...ends);
      if (latestPayment === null || latestPayment <= lastEnd) return { category: 'cancelled', paidRecently };
      return { category: 'paying', paidRecently };
    }
  }

  const first = time(b.payments.first);
  const paidByCard = first !== null && first <= t;
  // Invoices that never reached us: Stripe's own word that it has charged.
  const paidBySubscription = live !== null && b.status !== null && CHARGED.has(b.status);
  if (paidByCard || paidBySubscription) return { category: 'paying', paidRecently };
  return { category: 'never_paid', paidRecently };
}
