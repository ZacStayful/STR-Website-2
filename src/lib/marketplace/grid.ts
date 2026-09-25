/**
 * The marketplace grid's filters, what a card is allowed to show, and the
 * badges on it. Pure, so the URL ↔ filter round trip and the "never leak the
 * address" rule are tested rather than trusted.
 */
import { AREA_META } from '../market/areas.ts';
import type { Beds } from '../market/filters.ts';
import type { ListingSource } from '../listing/types.ts';
import type { SourcingKind } from '../listing/sourcing.ts';
import type { ConfirmedVia, DealStatus } from './types.ts';

export type DealKindFilter = 'both' | 'sale' | 'rent';
export type DealSort = 'profit' | 'uplift' | 'newest' | 'price';

export interface DealFilters {
  kind: DealKindFilter;
  /** Postcode area codes, uppercase, validated against AREA_META. */
  areas: string[];
  beds: Beds;
  minPrice: number | null;
  maxPrice: number | null;
  /** Annual profit floor, £. */
  minProfit: number | null;
  /** Uplift floor, %. Sales only: rentals have no uplift figure. */
  minUplift: number | null;
  sort: DealSort;
  page: number;
}

export const PAGE_SIZE = 24;
export const MAX_PAGE = 500;

export const DEFAULT_FILTERS: DealFilters = { kind: 'both', areas: [], beds: 'any', minPrice: null, maxPrice: null, minProfit: null, minUplift: null, sort: 'profit', page: 1 };

export const SORT_LABELS: Record<DealSort, string> = { profit: 'Highest profit', uplift: 'Highest uplift', newest: 'Newest', price: 'Lowest price' };
export const KIND_LABELS: Record<DealKindFilter, string> = { both: 'Buy or rent', sale: 'To buy', rent: 'Rent-to-rent' };

const AREA_CODES = new Set(AREA_META.map((a) => a.code));

type Raw = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function num(v: string | string[] | undefined, min: number, max: number): number | null {
  const s = first(v);
  if (s === null || s.trim() === '') return null;
  const n = Number(s.replace(/[£,%\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** Every value is whitelisted or clamped; junk falls back to the default rather than erroring. */
export function parseDealFilters(raw: Raw): DealFilters {
  const kind = first(raw.kind);
  const beds = first(raw.beds);
  const sort = first(raw.sort);
  const areasRaw = raw.areas ?? raw.area;
  const areaList = (Array.isArray(areasRaw) ? areasRaw : areasRaw ? areasRaw.split(',') : [])
    .map((a) => a.trim().toUpperCase())
    .filter((a) => AREA_CODES.has(a));
  const minPrice = num(raw.minPrice, 0, 50_000_000);
  const maxPrice = num(raw.maxPrice, 0, 50_000_000);
  return {
    kind: kind === 'sale' || kind === 'rent' ? kind : 'both',
    areas: [...new Set(areaList)],
    beds: beds === '1' || beds === '2' || beds === '3' || beds === '4+' ? beds : 'any',
    minPrice,
    maxPrice: maxPrice !== null && minPrice !== null && maxPrice < minPrice ? null : maxPrice,
    minProfit: num(raw.minProfit, 0, 10_000_000),
    minUplift: num(raw.minUplift, 0, 10_000),
    sort: sort === 'uplift' || sort === 'newest' || sort === 'price' ? sort : 'profit',
    page: num(raw.page, 1, MAX_PAGE) ?? 1,
  };
}

/** Back to a query string, defaults omitted, so links and chips stay short and stable. */
export function filtersToSearch(f: Partial<DealFilters>): string {
  const p = new URLSearchParams();
  if (f.kind && f.kind !== 'both') p.set('kind', f.kind);
  if (f.areas && f.areas.length > 0) p.set('areas', f.areas.join(','));
  if (f.beds && f.beds !== 'any') p.set('beds', f.beds);
  if (f.minPrice) p.set('minPrice', String(f.minPrice));
  if (f.maxPrice) p.set('maxPrice', String(f.maxPrice));
  if (f.minProfit) p.set('minProfit', String(f.minProfit));
  if (f.minUplift) p.set('minUplift', String(f.minUplift));
  if (f.sort && f.sort !== 'profit') p.set('sort', f.sort);
  if (f.page && f.page > 1) p.set('page', String(f.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * What the grid selects. NEVER canonical_url, address, postcode, photo or
 * photos: those are what a member pays to see. The card's image goes through
 * the signed photo route by deal id.
 */
export const PUBLIC_DEAL_COLUMNS = [
  'id',
  'source',
  'kind',
  'postcode_area',
  'outcode',
  'town',
  'bedrooms',
  'price_amount',
  'price_period',
  'raw_type',
  'tenure',
  'band',
  'annual_profit',
  'uplift_pct',
  'reduced_at',
  'listed_date',
  'status',
  'first_seen_at',
  'last_checked_live_at',
  'last_confirmed_at',
  'last_confirmed_via',
].join(', ');

export const PRIVATE_DEAL_COLUMNS: readonly string[] = ['canonical_url', 'address', 'postcode', 'photo', 'photos'];

export interface DealCard {
  id: string;
  source: ListingSource;
  kind: SourcingKind;
  postcode_area: string | null;
  outcode: string | null;
  town: string | null;
  bedrooms: number | null;
  price_amount: number | null;
  price_period: string | null;
  raw_type: string | null;
  tenure: string | null;
  band: string;
  annual_profit: number | null;
  uplift_pct: number | null;
  reduced_at: string | null;
  listed_date: string | null;
  status: DealStatus;
  first_seen_at: string;
  last_checked_live_at: string | null;
  last_confirmed_at: string;
  last_confirmed_via: ConfirmedVia;
  /** True when the row carries a photo, so the card knows whether to ask the photo route. */
  has_photo?: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface Badges {
  tags: ('New today' | 'Reduced')[];
  /** "Checked live 6h ago" / "Confirmed by feed today" / "Confirmed by feed 3 days ago". */
  freshness: string;
  freshnessKind: 'live' | 'feed';
}

function agoWords(iso: string, now: Date): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  if (diff < HOUR_MS) return 'just now';
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;
  const days = Math.floor(diff / DAY_MS);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function badgesFor(card: Pick<DealCard, 'first_seen_at' | 'reduced_at' | 'last_checked_live_at' | 'last_confirmed_at' | 'last_confirmed_via'>, now: Date = new Date()): Badges {
  const tags: Badges['tags'] = [];
  const seen = new Date(card.first_seen_at).getTime();
  if (Number.isFinite(seen) && now.getTime() - seen < DAY_MS) tags.push('New today');
  const reduced = card.reduced_at ? new Date(card.reduced_at).getTime() : NaN;
  if (Number.isFinite(reduced) && now.getTime() - reduced < 14 * DAY_MS) tags.push('Reduced');
  const live = card.last_checked_live_at ? new Date(card.last_checked_live_at).getTime() : NaN;
  const confirmed = new Date(card.last_confirmed_at).getTime();
  // The live check is the stronger claim; use it when it is the more recent confirmation, or the only one.
  if (Number.isFinite(live) && (card.last_confirmed_via === 'live' || live >= confirmed)) {
    return { tags, freshness: `Checked live ${agoWords(card.last_checked_live_at!, now)}`, freshnessKind: 'live' };
  }
  const words = agoWords(card.last_confirmed_at, now);
  return { tags, freshness: `Confirmed by feed ${words === 'just now' || words.endsWith('h ago') ? 'today' : words}`, freshnessKind: 'feed' };
}

/** "3 bed terraced · Freehold" for the card's second line. */
export function describeType(card: Pick<DealCard, 'bedrooms' | 'raw_type' | 'tenure'>): string {
  const parts: string[] = [];
  if (card.bedrooms !== null) parts.push(`${card.bedrooms} bed`);
  if (card.raw_type) parts.push(card.raw_type.toLowerCase());
  const head = parts.join(' ');
  return card.tenure ? (head ? `${head} · ${card.tenure}` : card.tenure) : head;
}

const gbpWhole = (n: number): string => `£${Math.round(n).toLocaleString('en-GB')}`;

/** "£250,000" or "£1,200 pcm". */
export function priceLine(card: Pick<DealCard, 'price_amount' | 'price_period'>): string | null {
  if (card.price_amount === null) return null;
  const n = Number(card.price_amount);
  return card.price_period === 'pcm' ? `${gbpWhole(n)} pcm` : gbpWhole(n);
}

/** The one number a card leads with: uplift for a purchase, annual profit for rent-to-rent. */
export function headlineFigure(card: Pick<DealCard, 'kind' | 'annual_profit' | 'uplift_pct'>): { big: string; small: string } {
  const profit = card.annual_profit === null ? null : Number(card.annual_profit);
  if (card.kind === 'rent') return { big: profit === null ? '—' : `${gbpWhole(profit)}/yr`, small: 'profit after rent' };
  const uplift = card.uplift_pct === null ? null : Number(card.uplift_pct);
  return { big: uplift === null ? '—' : `+${Math.round(uplift)}%`, small: profit === null ? 'over a long let' : `${gbpWhole(profit)}/yr over a long let` };
}

// ── The Market Explorer's "deals on the market here" block ──

/** One deal as the area page shows it: already formatted, nothing private, serialisable to the client. */
export interface AreaDealView {
  id: string;
  kind: SourcingKind;
  /** "Acomb · YO24" */
  where: string;
  type: string;
  price: string | null;
  figureBig: string;
  figureSmall: string;
  tags: Badges['tags'];
  freshness: string;
  freshnessKind: Badges['freshnessKind'];
  photoUrl: string | null;
  source: ListingSource;
}

export interface AreaDealsSummary {
  code: string;
  sale: number;
  rent: number;
  total: number;
  medianProfit: number | null;
  top: AreaDealView[];
}

export function areaDealView(card: DealCard, photoUrl: string | null, now: Date = new Date()): AreaDealView {
  const badges = badgesFor(card, now);
  const figure = headlineFigure(card);
  return {
    id: card.id,
    kind: card.kind,
    where: [card.town, card.outcode].filter(Boolean).join(' · '),
    type: describeType(card),
    price: priceLine(card),
    figureBig: figure.big,
    figureSmall: figure.small,
    tags: badges.tags,
    freshness: badges.freshness,
    freshnessKind: badges.freshnessKind,
    photoUrl,
    source: card.source,
  };
}
