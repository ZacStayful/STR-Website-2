/**
 * Daily re-check of saved listings: pure helpers for diffing a fresh
 * snapshot against what the member last saw and keeping a price/status
 * history on the row. The cron route does the fetching and the database
 * work; the alerts built from the history are Batch 6's (src/lib/notify).
 */
import type { ListingKind, ListingPrice, ListingStatus } from './types.ts';
import { formatListingPrice } from './format.ts';
import { purchaseDeal, rentToRentDeal, type Deal } from './deal.ts';
import type { QuickEstimate } from './quick-types.ts';

export interface PriceHistoryEntry {
  at: string;
  amount: number | null;
  period: string | null;
  status: ListingStatus | null;
  previousAmount: number | null;
  previousStatus: ListingStatus | null;
  /**
   * Legacy: true on entries the pre-Batch-6 re-check emailed itself. Delivery
   * is now tracked in deal_alerts (src/lib/notify), and new entries stay false.
   */
  notified: boolean;
}

export interface ListingState {
  price?: ListingPrice | null;
  status?: ListingStatus | null;
}

const STATUS_LABEL: Record<ListingStatus, string> = {
  available: 'back on the market',
  under_offer: 'now under offer / sold STC',
  let_agreed: 'now let agreed',
  sold: 'now sold',
  removed: 'no longer listed',
};

/** A price or status change worth telling the member about, else null. */
export function diffListing(prev: ListingState, next: ListingState, at: string): PriceHistoryEntry | null {
  const prevAmount = prev.price?.amount ?? null;
  const nextAmount = next.price?.amount ?? null;
  const prevStatus = prev.status ?? 'available';
  const nextStatus = next.status ?? null;
  const priceChanged = prevAmount !== null && nextAmount !== null && Math.abs(nextAmount - prevAmount) >= 1;
  const statusChanged = nextStatus !== null && nextStatus !== prevStatus;
  if (!priceChanged && !statusChanged) return null;
  return {
    at,
    amount: nextAmount,
    period: next.price?.period ?? prev.price?.period ?? null,
    status: statusChanged ? nextStatus : null,
    previousAmount: priceChanged ? prevAmount : null,
    previousStatus: statusChanged ? prevStatus : null,
    notified: false,
  };
}

export function parseHistory(raw: unknown): PriceHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PriceHistoryEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.at !== 'string') continue;
    out.push({
      at: o.at,
      amount: typeof o.amount === 'number' ? o.amount : null,
      period: typeof o.period === 'string' ? o.period : null,
      status: typeof o.status === 'string' ? (o.status as ListingStatus) : null,
      previousAmount: typeof o.previousAmount === 'number' ? o.previousAmount : null,
      previousStatus: typeof o.previousStatus === 'string' ? (o.previousStatus as ListingStatus) : null,
      notified: o.notified === true,
    });
  }
  return out;
}

/** "£220,000 → £210,000 (−4.5%)" or "now under offer". */
export function describeChange(e: PriceHistoryEntry): string {
  const parts: string[] = [];
  if (e.previousAmount !== null && e.amount !== null) {
    const pct = ((e.amount - e.previousAmount) / e.previousAmount) * 100;
    const arrow = e.amount < e.previousAmount ? 'down' : 'up';
    parts.push(`price ${arrow} from ${formatListingPrice({ amount: e.previousAmount, period: e.period ?? 'total' })} to ${formatListingPrice({ amount: e.amount, period: e.period ?? 'total' })} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`);
  }
  if (e.status) parts.push(STATUS_LABEL[e.status] ?? e.status);
  return parts.join('; ');
}

/**
 * Re-runs the stored deal at a new asking price / rent using the estimate
 * and finance inputs the row already carries, so the pipeline's yield or
 * margin follows the price without another provider call.
 */
export function dealAtNewPrice(quick: QuickEstimate | null, deal: Deal | null, price: ListingPrice, kind: ListingKind, bedrooms: number | null): Deal | null {
  const est = quick?.estimate;
  if (!est || !deal) return null;
  const base = { grossRevenue: est.grossRevenue, adr: est.adr ?? 0, bedrooms: bedrooms ?? 2 };
  if (kind === 'sale' && deal.kind === 'purchase' && price.period === 'total') {
    return purchaseDeal(price.amount, { ...base, finance: { depositPct: deal.depositPct, mortgageRatePct: deal.mortgageRatePct, termYears: deal.termYears, targetYieldPct: deal.targetYieldPct } });
  }
  if (kind === 'rent' && deal.kind === 'rent-to-rent') {
    const pcm = price.period === 'pcm' ? price.amount : price.period === 'pw' ? Math.round((price.amount * 52) / 12) : null;
    return pcm ? rentToRentDeal(pcm, { ...base, finance: { targetMarginPcm: deal.targetMarginPcm } }) : null;
  }
  return null;
}
