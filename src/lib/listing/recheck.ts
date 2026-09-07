/**
 * Daily re-check of saved listings: pure helpers for diffing a fresh
 * snapshot against what the member last saw, keeping a price/status history
 * on the row, and writing the alert email. The cron route does the fetching
 * and the database work; everything here is testable without either.
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
  /** Flipped once the change has been emailed; a failed send retries next run. */
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

export function pendingEntries(history: PriceHistoryEntry[]): PriceHistoryEntry[] {
  return history.filter((e) => !e.notified);
}

export function markNotified(history: PriceHistoryEntry[]): PriceHistoryEntry[] {
  return history.map((e) => (e.notified ? e : { ...e, notified: true }));
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

export interface RecheckAlertItem {
  id: string;
  title: string;
  address: string | null;
  canonicalUrl: string;
  entries: PriceHistoryEntry[];
}

export function hasPriceDrop(items: RecheckAlertItem[]): boolean {
  return items.some((i) => i.entries.some((e) => e.previousAmount !== null && e.amount !== null && e.amount < e.previousAmount));
}

export function recheckEmail(items: RecheckAlertItem[], siteUrl: string): { subject: string; text: string; html: string } {
  const drop = hasPriceDrop(items);
  const subject =
    items.length === 1
      ? `${drop ? 'Price drop' : 'Update'} on a listing you are watching: ${items[0].title}`
      : `${drop ? 'Price drops and updates' : 'Updates'} on ${items.length} listings you are watching`;
  const line = (i: RecheckAlertItem) => `${i.address ?? i.title}: ${i.entries.map(describeChange).join('; ')}`;
  const pipeline = `${siteUrl}/markets?pane=listings`;
  const text = [
    'Your daily listing re-check from Stayful.',
    '',
    ...items.map((i) => `• ${line(i)}\n  ${i.canonicalUrl}\n  Open in Stayful: ${pipeline}&listing=${encodeURIComponent(i.id)}`),
    '',
    `Your pipeline: ${pipeline}`,
    'Mark a listing as Passed in your pipeline to stop re-checking it.',
  ].join('\n');
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#2e3d2b;max-width:560px">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5d8156;font-weight:600">Stayful Deal Pipeline</p>
      <h1 style="font-size:22px;margin:0 0 14px">${esc(drop ? 'A listing you are watching moved' : 'Updates on listings you are watching')}</h1>
      <ul style="padding-left:18px">${items
        .map(
          (i) =>
            `<li style="margin:10px 0"><strong>${esc(i.address ?? i.title)}</strong><br>${esc(i.entries.map(describeChange).join('; '))}<br><a href="${esc(`${pipeline}&listing=${encodeURIComponent(i.id)}`)}" style="color:#5d8156">Open in Stayful</a> · <a href="${esc(i.canonicalUrl)}" style="color:#7a8274">View listing</a></li>`,
        )
        .join('')}</ul>
      <p style="margin:22px 0"><a href="${esc(pipeline)}" style="display:inline-block;background:#5d8156;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600">Open my pipeline</a></p>
      <p style="color:#7a8274;font-size:12px">You get this because these listings are in your pipeline. Mark one as Passed to stop re-checking it.</p>
    </div>`.trim();
  return { subject, text, html };
}
