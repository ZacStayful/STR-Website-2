/**
 * The offer message's amount, typed by the member in the browser.
 *
 * The server renders the offer message twice: once without an amount (the
 * bracket holding {offerAmount} dropped) and once with OFFER_SLOT where the
 * amount goes. The browser shows the first until the member has a valid
 * amount in the box, then the second with the slot replaced. So the
 * template syntax never reaches the browser and a member can never copy a
 * raw placeholder.
 *
 * Pure and tiny, for client components.
 */

/** Stands in for the amount in the server-rendered text. Never shown. */
export const OFFER_SLOT = '@@OFFER_AMOUNT@@';

/** "£171,000", "171000", "171k" → 171000. Null for anything that is not a sensible positive amount. */
export function parseAmount(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/[£,\s]/g, '');
  if (s === '') return null;
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1);
  if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) return null;
  return Math.round(n);
}

export function formatAmount(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

/** The text with the amount put in, or the no-amount version when there is no valid amount. */
export function withOfferAmount(texts: { withAmount: string; without: string }, amount: number | null): string {
  if (amount === null) return texts.without;
  return texts.withAmount.split(OFFER_SLOT).join(formatAmount(amount));
}
