/**
 * Batch 21 (C1): what a white-label page must not say.
 *
 * The data-quality disclaimers the short-let provider produces when
 * comparables are thin end in "Book a web meeting with Stayful ..." (see
 * src/lib/apis/airbtics.ts and src/lib/analysis/run.ts). On Stayful's own
 * report that is the pitch; on a customer's funnel or a prospect's report it
 * names a competitor of the customer. The sentence is also stored inside
 * every saved report, so it is taken out where it is rendered rather than
 * where it is produced.
 *
 * Pure: no network, no database, no server-only.
 */

const STAYFUL_PITCH = /\s*Book a web meeting with Stayful[^.]*\.?/gi;

/** The disclaimer without its Stayful sentence; the rest is left as it was. */
export function stripStayfulPitch(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(STAYFUL_PITCH, '').replace(/\s{2,}/g, ' ').trim();
}
