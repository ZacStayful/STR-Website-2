/**
 * Client-safe types and pure helpers for a member's checked listings (the
 * deal pipeline shown in the Market Explorer).
 */
import type { Deal } from './deal.ts';
import type { ListingKind, ListingSource, ListingStatus } from './types.ts';
import type { QuickEstimate } from './quick-types.ts';
import { postcodeAreaOf } from './normalise.ts';

export type PipelineStatus = 'watching' | 'viewing' | 'offer' | 'passed';

export const PIPELINE_STATUSES: { key: PipelineStatus; label: string; colour: string }[] = [
  { key: 'watching', label: 'Watching', colour: '#5d8156' },
  { key: 'viewing', label: 'Viewing booked', colour: '#9a7b2e' },
  { key: 'offer', label: 'Offer made', colour: '#2e3d2b' },
  { key: 'passed', label: 'Passed', colour: '#9aa39b' },
];

export function isPipelineStatus(v: unknown): v is PipelineStatus {
  return v === 'watching' || v === 'viewing' || v === 'offer' || v === 'passed';
}

export interface CheckedListingRow {
  id: string;
  canonicalUrl: string;
  source: ListingSource;
  kind: ListingKind;
  postcode: string | null;
  postcodeArea: string | null;
  lat: number | null;
  lng: number | null;
  title: string;
  displayAddress: string | null;
  photo: string | null;
  bedrooms: number | null;
  price: { amount: number; period: string } | null;
  listingStatus: ListingStatus | null;
  status: PipelineStatus;
  notes: string;
  shareToken: string | null;
  analysedReportId: string | null;
  quick: QuickEstimate | null;
  deal: Deal | null;
  updatedAt: string;
}

export type ListingSort = 'fit' | 'newest' | 'return';

export const LISTING_SORT_LABELS: Record<ListingSort, string> = { fit: 'Your fit', newest: 'Most recent', return: 'Best return' };

/** Yield (purchase) or monthly margin (rent-to-rent) as one comparable number, higher is better. */
export function dealReturn(deal: Deal | null): number | null {
  if (!deal) return null;
  if (deal.kind === 'purchase') return deal.grossYieldPct;
  return deal.monthlyMargin;
}

/**
 * Blends the area's fit (personal score when goals exist, else the Stayful
 * score) with how the deal itself stacks up against the member's targets.
 */
export function listingFit(row: CheckedListingRow, areaFit: number | null): number | null {
  return blendFit(row.deal, areaFit ?? row.quick?.area?.score ?? null);
}

/** 60% area fit, 40% how the deal stacks against the member's targets; null when neither is known. */
export function blendFit(deal: Deal | null, areaFit: number | null): number | null {
  let dealPoints: number | null = null;
  if (deal?.kind === 'purchase') dealPoints = Math.max(0, Math.min(100, (deal.grossYieldPct / deal.targetYieldPct) * 60));
  if (deal?.kind === 'rent-to-rent') dealPoints = Math.max(0, Math.min(100, 50 + (deal.monthlyMargin / Math.max(1, deal.targetMarginPcm)) * 25));
  if (areaFit === null && dealPoints === null) return null;
  if (areaFit === null) return Math.round(dealPoints!);
  if (dealPoints === null) return Math.round(areaFit);
  return Math.round(areaFit * 0.6 + dealPoints * 0.4);
}

export function sortListings(rows: CheckedListingRow[], key: ListingSort, areaFit: (row: CheckedListingRow) => number | null): CheckedListingRow[] {
  const val = (r: CheckedListingRow): number => {
    if (key === 'newest') return new Date(r.updatedAt).getTime();
    if (key === 'return') return dealReturn(r.deal) ?? -Infinity;
    return listingFit(r, areaFit(r)) ?? -Infinity;
  };
  return [...rows].sort((a, b) => val(b) - val(a));
}

/** Trims a stored checked_listings row (snapshot jsonb etc.) to the client shape. */
export function toCheckedListingRow(raw: Record<string, unknown>): CheckedListingRow | null {
  const snap = (raw.snapshot ?? {}) as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const url = typeof raw.canonical_url === 'string' ? raw.canonical_url : null;
  if (!id || !url) return null;
  const price = snap.price as { amount?: unknown; period?: unknown } | undefined;
  const photos = Array.isArray(snap.photos) ? (snap.photos as unknown[]) : [];
  return {
    id,
    canonicalUrl: url,
    source: String(raw.source) as ListingSource,
    kind: String(raw.kind) as ListingKind,
    postcode: typeof raw.postcode === 'string' ? raw.postcode : null,
    postcodeArea: typeof raw.postcode_area === 'string' ? raw.postcode_area : null,
    lat: typeof raw.lat === 'number' ? raw.lat : null,
    lng: typeof raw.lng === 'number' ? raw.lng : null,
    title: typeof snap.title === 'string' ? snap.title : url,
    displayAddress: typeof snap.displayAddress === 'string' ? snap.displayAddress : null,
    photo: typeof photos[0] === 'string' ? photos[0] : null,
    bedrooms: typeof snap.bedrooms === 'number' ? snap.bedrooms : null,
    price: price && typeof price.amount === 'number' ? { amount: price.amount, period: String(price.period ?? 'total') } : null,
    listingStatus: (typeof raw.listing_status === 'string' ? raw.listing_status : null) as ListingStatus | null,
    status: isPipelineStatus(raw.status) ? raw.status : 'watching',
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    shareToken: typeof raw.share_token === 'string' ? raw.share_token : null,
    analysedReportId: typeof raw.analysed_report_id === 'string' ? raw.analysed_report_id : null,
    quick: (raw.quick_estimate as QuickEstimate | null) ?? null,
    deal: (raw.deal as Deal | null) ?? null,
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : new Date(0).toISOString(),
  };
}

/** Builds a pipeline row from a fresh /api/listing/resolve response (client side). */
export function rowFromResolved(res: { snapshot: import('./types.ts').ListingSnapshot; quick: QuickEstimate | null; checkedListingId: string | null }): CheckedListingRow | null {
  const id = res.checkedListingId;
  if (!id) return null;
  const s = res.snapshot;
  return {
    id,
    canonicalUrl: s.canonicalUrl,
    source: s.source,
    kind: s.kind,
    postcode: s.postcode ?? null,
    postcodeArea: postcodeAreaOf(s.outcode ?? s.postcode),
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    title: s.title,
    displayAddress: s.displayAddress ?? null,
    photo: s.photos[0] ?? null,
    bedrooms: s.bedrooms ?? null,
    price: s.price ? { amount: s.price.amount, period: s.price.period } : null,
    listingStatus: s.status ?? null,
    status: 'watching',
    notes: '',
    shareToken: null,
    analysedReportId: null,
    quick: res.quick,
    deal: res.quick?.deal ?? null,
    updatedAt: new Date().toISOString(),
  };
}
