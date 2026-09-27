/**
 * The rules of a Full analysis purchase that need no database: what it costs
 * this account, when a purchase left pending is abandoned, and what the
 * member is told. The orchestration is src/lib/analysis/deal-analysis.ts.
 *
 * Pure: no server-only, relative `.ts` imports only.
 */

import { dealAnalysisDue, type DealAnalysisDue, type DealPricing } from '../credit/deal-pricing.ts';

/** A pending purchase nothing has touched for this long is abandoned (a run never outlives the 60s function limit). */
export const ANALYSIS_STALE_MS = 3 * 60 * 1000;
/** The run must start this soon after the start request: well inside the reservation's own life. */
export const RUN_START_WINDOW_MS = 10 * 60 * 1000;
/** The reservation's life, in minutes. */
export const ANALYSIS_RESERVATION_MINUTES = 15;

export interface AnalysisQuote {
  /** The deal is open to this account already (or the viewer is an admin). */
  opened: boolean;
  /** What the account paid to open it, taken off the Full analysis. */
  openPaidBasePence: number;
  withPmi: boolean;
  due: DealAnalysisDue;
}

const FREE: DealAnalysisDue = { openBasePence: 0, analysisBasePence: 0, pmiBasePence: 0, totalBasePence: 0, purchaseBasePence: 0 };

/**
 * What a Full analysis costs this account. Admins pay nothing. A deal not
 * yet open is opened at `openPricePence` (the ladder) as part of it.
 */
export function analysisQuote(input: { admin: boolean; pricing: Pick<DealPricing, 'fullAnalysisPence' | 'pmiAddonPence'>; opened: boolean; openPaidBasePence: number | null | undefined; openPricePence: number; withPmi: boolean }): AnalysisQuote {
  const opened = input.admin || input.opened;
  const openPaid = input.opened ? Math.max(0, Number(input.openPaidBasePence) || 0) : 0;
  if (input.admin) return { opened, openPaidBasePence: openPaid, withPmi: input.withPmi, due: FREE };
  return {
    opened,
    openPaidBasePence: openPaid,
    withPmi: input.withPmi,
    due: dealAnalysisDue({ fullPence: input.pricing.fullAnalysisPence, pmiPence: input.pricing.pmiAddonPence, withPmi: input.withPmi, opened, openPaidBasePence: openPaid, openPricePence: input.openPricePence }),
  };
}

/** The price the member confirmed is the price: any difference, and nothing is charged. */
export function quoteMatches(quotedBasePence: unknown, due: Pick<DealAnalysisDue, 'purchaseBasePence'>): boolean {
  const q = typeof quotedBasePence === 'number' ? quotedBasePence : typeof quotedBasePence === 'string' && quotedBasePence.trim() !== '' ? Number(quotedBasePence) : NaN;
  return Number.isFinite(q) && Math.abs(q - due.purchaseBasePence) < 0.005;
}

export interface PendingTimes {
  created_at: string;
  ready_at: string | null;
  run_started_at: string | null;
}

/** A pending purchase that no request is working on any more. */
export function purchaseStale(row: PendingTimes, now: Date = new Date()): boolean {
  const last = Date.parse(row.run_started_at ?? row.ready_at ?? row.created_at);
  return !Number.isFinite(last) || now.getTime() - last >= ANALYSIS_STALE_MS;
}

/** A started purchase whose run was never asked for in time. */
export function runWindowClosed(row: Pick<PendingTimes, 'ready_at'>, now: Date = new Date()): boolean {
  if (!row.ready_at) return false;
  const ready = Date.parse(row.ready_at);
  return !Number.isFinite(ready) || now.getTime() - ready >= RUN_START_WINDOW_MS;
}

export type AnalysisErrorCode =
  | 'signed_out'
  | 'seat_paused'
  | 'missing'
  | 'no_postcode'
  | 'no_price'
  | 'invalid'
  | 'pmi_unavailable'
  | 'already_done'
  | 'running'
  | 'price_changed'
  | 'insufficient_credit'
  | 'gone'
  | 'just_gone'
  | 'checking'
  | 'rate_limited'
  | 'expired'
  | 'incomplete'
  | 'failed';

const MESSAGES: Record<AnalysisErrorCode, string> = {
  signed_out: 'Sign in to run a Full analysis.',
  seat_paused: 'Your seat on this team is paused, so you can’t spend the team’s credit. Ask the team owner to restore it.',
  missing: 'We couldn’t find that deal.',
  no_postcode: 'A Full analysis needs the property’s full postcode, and this listing doesn’t show one. You can still take a Quick look.',
  no_price: 'A Full analysis of a rental needs its rent, and this listing doesn’t show one. You can still take a Quick look.',
  invalid: 'We couldn’t read this listing well enough to analyse it. You can still take a Quick look.',
  pmi_unavailable: 'The PMI second opinion is switched off just now. Untick it to run the Full analysis.',
  already_done: 'This deal already has a Full analysis. Nothing was charged.',
  running: 'A Full analysis of this deal is already running. It’ll be ready in a minute.',
  price_changed: 'The price has changed since this page loaded. Nothing was charged; check the new price and confirm again.',
  insufficient_credit: 'Not enough credit for the Full analysis. Nothing was charged.',
  gone: 'This deal is no longer on the market. Nothing was charged.',
  just_gone: 'This one has just gone off the market. Nothing was charged.',
  checking: 'We’re checking this listing is still on the market. Nothing was charged; try again shortly.',
  rate_limited: 'You’ve opened a lot of deals in the last hour. Give it a few minutes and try again. Nothing was charged.',
  expired: 'This Full analysis wasn’t started in time. Nothing was charged for it; start it again from the deal.',
  incomplete: 'We couldn’t get short-let figures for this property just now, so the Full analysis wasn’t charged. Please try again later.',
  failed: 'Something went wrong running the Full analysis. You haven’t been charged for it; please try again.',
};

/**
 * What the member is told. When the purchase opened the deal on the way,
 * that Quick look stays charged (Q11): the address is theirs now.
 */
export function analysisMessage(code: AnalysisErrorCode, opts: { openedByPurchase?: boolean } = {}): string {
  const base = MESSAGES[code] ?? MESSAGES.failed;
  if (!opts.openedByPurchase) return base;
  if (code === 'insufficient_credit') return 'The deal is open to you now, but there isn’t enough credit left for the Full analysis, so only the Quick look was charged.';
  if (code === 'incomplete' || code === 'failed' || code === 'expired') return `${base} The Quick look stays charged: the deal is open to you for good.`;
  return base;
}

export function analysisHttpStatus(code: AnalysisErrorCode): number {
  switch (code) {
    case 'signed_out':
      return 401;
    case 'seat_paused':
    case 'insufficient_credit':
      return 402;
    case 'missing':
      return 404;
    case 'gone':
    case 'just_gone':
    case 'expired':
      return 410;
    case 'no_postcode':
    case 'no_price':
    case 'invalid':
    case 'pmi_unavailable':
      return 422;
    case 'rate_limited':
      return 429;
    case 'already_done':
    case 'running':
    case 'price_changed':
    case 'checking':
      return 409;
    default:
      return 500;
  }
}

/** The ledger line's description: the area and kind, never the address. */
export function analysisDescription(deal: { town: string | null; postcode_area: string | null; kind: string }, reused: boolean): string {
  const where = [deal.town, deal.postcode_area].filter(Boolean).join(', ') || 'a deal';
  return `Full analysis: ${where} (${deal.kind === 'rent' ? 'rent-to-rent' : 'to buy'})${reused ? ', from a saved analysis' : ''}`;
}
