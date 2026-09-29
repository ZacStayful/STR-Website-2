/**
 * The five conversions Meta is told about, and the rules for each. Every
 * decision about "does this count, and as what" is here and tested; the
 * server code only looks things up and records.
 *
 *   CompleteRegistration  a website account (email or Google) is first signed
 *                         in. Not lead-form accounts (the n8n lead workflow
 *                         reports those), not team seats. Once per account.
 *   ProfileComplete       the profile quiz is first complete. Once per account.
 *   FirstReport           the first finished analyser report or Full analysis.
 *                         Once per account.
 *   Subscribe             the first paid invoice (amount > 0) of a subscription
 *                         started after tracking began. Once per member.
 *   Purchase              a card top-up the member chose (Checkout or
 *                         one-click), not an automatic top-up. Once per payment.
 *
 * The first three only count for accounts created after tracking began
 * (billing_settings.meta_tracking_since), so existing members never fire them.
 * Values are in GBP, excluding VAT. Pure: no network, no database, no server-only.
 */
import { EVENT_SOURCE_PATHS } from '../tracking/config.ts';

export const META_EVENTS = ['CompleteRegistration', 'ProfileComplete', 'FirstReport', 'Subscribe', 'Purchase'] as const;
export type MetaEventName = (typeof META_EVENTS)[number];

/** Meta's own names are sent with fbq('track'); ours with fbq('trackCustom'). */
const CUSTOM: ReadonlySet<MetaEventName> = new Set<MetaEventName>(['ProfileComplete', 'FirstReport']);

export function isMetaEvent(v: unknown): v is MetaEventName {
  return typeof v === 'string' && (META_EVENTS as readonly string[]).includes(v);
}

export function isCustomEvent(name: MetaEventName): boolean {
  return CUSTOM.has(name);
}

/** Only the two payments carry a value. */
export function carriesValue(name: MetaEventName): boolean {
  return name === 'Subscribe' || name === 'Purchase';
}

/**
 * The one key that makes each conversion happen once: per account for the
 * journey events and Subscribe, per PaymentIntent for Purchase.
 */
export function dedupeKeyFor(name: MetaEventName, ids: { userId: string; paymentIntentId?: string | null }): string | null {
  if (!ids.userId) return null;
  if (name === 'Purchase') return ids.paymentIntentId ? `Purchase:${ids.paymentIntentId}` : null;
  return `${name}:${ids.userId}`;
}

/** The page a server event is reported against: always the site's own address, never a query string. */
export function eventSourceUrl(name: MetaEventName, siteBase: string): string {
  return `${siteBase.replace(/\/+$/, '')}${EVENT_SOURCE_PATHS[name]}`;
}

/** Pence to Meta's value (pounds, two places). */
export function penceToValue(pence: number): number {
  return Math.round(pence) / 100;
}

/** An account created at or after tracking began (the three journey events only count for these). */
export function isPostLaunch(createdAt: string | Date | null | undefined, trackingSince: string | Date | null | undefined): boolean {
  if (!createdAt || !trackingSince) return false;
  const c = new Date(createdAt).getTime();
  const t = new Date(trackingSince).getTime();
  return Number.isFinite(c) && Number.isFinite(t) && c >= t;
}

/** What the webhook knows about a paid subscription invoice. */
export interface InvoiceFacts {
  amountPaid: number | null | undefined;
  totalExcludingTax: number | null | undefined;
  billingReason: string | null | undefined;
  currency: string | null | undefined;
  /** When the subscription itself started (its start_date). */
  subscriptionStartedAt: string | Date | null | undefined;
}

/**
 * Whether a paid subscription invoice is a Subscribe, and its value in pence
 * (excluding VAT). A plan change's proration invoice never is; a £0 invoice
 * (a 100%-off first month) never is, so the first invoice actually paid is
 * the one that counts; a subscription started before tracking began never is,
 * so existing subscribers' renewals never fire. "The first" is the caller's
 * once-per-member key.
 */
export function subscribeFromInvoice(inv: InvoiceFacts, trackingSince: string | Date | null | undefined): { valuePence: number; currency: 'GBP' } | null {
  const paid = Number(inv.amountPaid ?? 0);
  if (!Number.isFinite(paid) || paid <= 0) return null;
  if ((inv.currency ?? 'gbp').toLowerCase() !== 'gbp') return null;
  const reason = inv.billingReason ?? null;
  if (reason !== null && reason !== 'subscription_create' && reason !== 'subscription_cycle' && reason !== 'manual') return null;
  if (!isPostLaunch(inv.subscriptionStartedAt ?? null, trackingSince)) return null;
  const exVat = Number(inv.totalExcludingTax);
  const valuePence = Number.isFinite(exVat) && exVat > 0 ? Math.min(exVat, paid) : paid;
  return { valuePence: Math.round(valuePence), currency: 'GBP' };
}

/** What a top-up PaymentIntent carries. */
export interface TopupFacts {
  /** metadata.kind: only 'topup' is a credit top-up. */
  kind: string | null | undefined;
  /** metadata.auto: '1' for an automatic top-up, which is not a Purchase. */
  auto: string | null | undefined;
  /** metadata.amount_pence: the credit bought, excluding VAT. */
  amountPence: string | number | null | undefined;
  currency: string | null | undefined;
}

/** Whether a paid top-up is a Purchase, and its value in pence (the credit bought, excluding VAT). */
export function purchaseFromTopup(t: TopupFacts): { valuePence: number; currency: 'GBP' } | null {
  if (t.kind !== 'topup') return null;
  if (t.auto === '1') return null;
  if ((t.currency ?? 'gbp').toLowerCase() !== 'gbp') return null;
  const pence = Number(t.amountPence);
  if (!Number.isFinite(pence) || pence <= 0) return null;
  return { valuePence: Math.round(pence), currency: 'GBP' };
}

/** The parameters the browser fires a conversion with (value only for the two payments). */
export function browserParams(name: MetaEventName, valuePence: number | null | undefined): Record<string, string | number> {
  if (!carriesValue(name) || valuePence === null || valuePence === undefined || !Number.isFinite(valuePence)) return {};
  return { value: penceToValue(valuePence), currency: 'GBP' };
}
