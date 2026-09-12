/**
 * Pure helpers for reading a Stripe subscription and for the self-serve pause.
 *
 * Stripe is imported for TYPES ONLY. The import is erased at runtime, so this
 * module stays loadable by the native type-stripping test runner without the
 * SDK ever being required — which is what makes every rule below unit-testable.
 */
import type Stripe from 'stripe'

export const PAUSE_MONTHS = [1, 2, 3] as const
export type PauseMonths = (typeof PAUSE_MONTHS)[number]

export function isPauseMonths(value: unknown): value is PauseMonths {
  return PAUSE_MONTHS.includes(Number(value) as PauseMonths)
}

/**
 * Add whole calendar months, clamping to the end of the target month.
 *
 * Date.setMonth rolls over: 31 January plus one month gives 3 March, which
 * would quietly hand the member two extra days of pause. Clamping gives
 * 28 February (29 in a leap year), which is what "one month" means to a person.
 */
export function addMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth() + months
  const day = from.getUTCDate()
  // Day 0 of the following month is the last day of the month we want.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  )
}

/**
 * When the current billing period ends.
 *
 * On recent Stripe API versions `current_period_end` moved off the
 * subscription and onto its items. The fallback keeps working for an account
 * still pinned to an older version, where only the top-level field exists.
 */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined
  const ts =
    item?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end
  return typeof ts === 'number' && Number.isFinite(ts) ? new Date(ts * 1000) : null
}

/**
 * The pause window to book for a subscription.
 *
 * It starts at the END of the period the member has already paid for, not
 * today. Pausing on day three of a paid month must not forfeit the other
 * twenty-seven days. Returns null when Stripe gives us no period end, which is
 * the one case where we cannot honour that and must refuse rather than guess.
 */
export function pauseWindow(
  sub: Stripe.Subscription,
  months: PauseMonths,
): { from: Date; until: Date } | null {
  const from = subscriptionPeriodEnd(sub)
  if (!from) return null
  return { from, until: addMonths(from, months) }
}

/**
 * Metadata key holding the start of OUR pause window.
 *
 * Stripe stores only `pause_collection.resumes_at` — it has no notion of a
 * pause that begins later. We keep the start alongside it on the subscription
 * itself rather than only in our own row, so the webhook can rebuild the whole
 * window from the event object and stay idempotent.
 */
export const PAUSED_FROM_KEY = 'stayful_paused_from'

/** Our columns, derived from a Stripe subscription. */
export interface SubscriptionState {
  status: string
  /** Live and collecting: not cancelled, not lapsed, not paused. */
  active: boolean
  pausedFrom: string | null
  pausedUntil: string | null
  cancelAt: string | null
  currentPeriodEnd: string | null
}

const LIVE = new Set(['active', 'trialing', 'past_due'])

/**
 * The single mapping from a Stripe subscription to the profile columns, used
 * by BOTH the webhook and the /account server actions so the two can never
 * disagree about what a subscription means.
 *
 * Every field is derived from the object Stripe sent, so writing the whole
 * result is idempotent: a replayed event produces the same row, and an
 * auto-resume (which arrives with `pause_collection: null`) clears the pause
 * window by itself.
 */
export function subscriptionStateFromStripe(sub: Stripe.Subscription): SubscriptionState {
  const status = String(sub.status ?? '').trim().toLowerCase()
  const currentPeriodEnd = subscriptionPeriodEnd(sub)

  // Stripe leaves pause_collection in place on a subscription that has ended,
  // so a member who cancelled while a pause was booked keeps a stale window.
  // A subscription that is over has no pause window: without this, the account
  // page would call them "paused until <date>" and offer a Resume button that
  // acts on a deleted subscription and dead-ends on an error. Access was never
  // wrong — they are refused throughout — but the wording and the button were.
  const live = LIVE.has(status)
  const resumesAt = live ? sub.pause_collection?.resumes_at : undefined
  const pausedUntil =
    typeof resumesAt === 'number' && Number.isFinite(resumesAt)
      ? new Date(resumesAt * 1000)
      : null

  return {
    status,
    active: live && !sub.pause_collection,
    pausedFrom: pausedFrom(sub, pausedUntil),
    pausedUntil: pausedUntil?.toISOString() ?? null,
    cancelAt: toIso(sub.cancel_at),
    currentPeriodEnd: currentPeriodEnd?.toISOString() ?? null,
  }
}

/**
 * The start of the pause window.
 *
 * Read back from the metadata we wrote when booking the pause. If a pause was
 * applied outside our UI — an admin using the Stripe dashboard — there is no
 * metadata, and the fair reading of someone pausing you by hand is that it
 * takes effect now. `start_date` is always in the past, so using it opens the
 * window immediately and, unlike `Date.now()`, gives the same answer on every
 * replay of the same event.
 */
function pausedFrom(sub: Stripe.Subscription, pausedUntil: Date | null): string | null {
  if (!sub.pause_collection || !pausedUntil) return null
  const tagged = sub.metadata?.[PAUSED_FROM_KEY]
  if (tagged) {
    const t = Date.parse(tagged)
    if (Number.isFinite(t)) return new Date(t).toISOString()
  }
  return toIso(sub.start_date) ?? new Date(0).toISOString()
}

function toIso(unix: number | null | undefined): string | null {
  return typeof unix === 'number' && Number.isFinite(unix)
    ? new Date(unix * 1000).toISOString()
    : null
}

/**
 * Format a plan date for display. Always called on the server, so client
 * components receive a finished string and there is no locale-driven
 * hydration mismatch between server and browser.
 */
export function formatPlanDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
