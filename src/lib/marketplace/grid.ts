/**
 * The marketplace grid's filters, what a card is allowed to show, and the
 * badges on it. Pure, so the URL ↔ filter round trip and the "never leak the
 * address" rule are tested rather than trusted.
 */
import { AREA_META } from '../market/areas.ts';
import type { Beds } from '../market/filters.ts';
import type { ListingSource } from '../listing/types.ts';
import type { SourcingKind } from '../listing/sourcing.ts';
import type { DealType } from '../market/goals.ts';
import type { ConfirmedVia, DealStatus } from './types.ts';
import { profitRange, rangeCaption, upliftTag } from './profit-range.ts';

export type DealKindFilter = 'both' | 'sale' | 'rent';
/** 'best' (Batch 14, the default): "Best for you", the member's own order (src/lib/tailoring/browse.ts). */
export type DealSort = 'best' | 'profit' | 'uplift' | 'newest' | 'price';
/**
 * Which of the member's own reactions a query reads: everything they have
 * not passed (the grid, Today), only kept, or only passed (the "you passed on
 * every deal" count). Since Batch 11 the grid itself is always 'all': an old
 * /deals?view=kept or ?view=passed link is parsed only to send it to My deals.
 */
export type DealView = 'all' | 'kept' | 'passed';

export interface DealFilters {
  kind: DealKindFilter;
  /**
   * Batch 17: the deal types shown (Buy and let / BRRR / Rent-to-rent); empty
   * for all of them. Browse defaults it to the profile's chosen types; the
   * URL's `type=all` is "All types".
   */
  types: DealType[];
  /**
   * Batch 17: BRRR deals only at light-refresh level (a "Light refresh"
   * answer on the untailored path, Q24). Never from the URL; a tailored
   * profile judges the level as a must-have it can switch instead.
   */
  brrrLightOnly?: boolean;
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
  view: DealView;
  page: number;
}

export const PAGE_SIZE = 24;
export const MAX_PAGE = 500;

export const DEFAULT_FILTERS: DealFilters = { kind: 'both', types: [], areas: [], beds: 'any', minPrice: null, maxPrice: null, minProfit: null, minUplift: null, sort: 'best', view: 'all', page: 1 };

export const SORT_LABELS: Record<DealSort, string> = { best: 'Best for you', profit: 'Highest profit', uplift: 'Highest uplift', newest: 'Newest', price: 'Lowest price' };
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

const TYPE_VALUES: readonly DealType[] = ['buy_let', 'brrr', 'r2r'];

/** The URL's "All types" (Browse's one-click way past the profile's own types). */
export const ALL_TYPES_PARAM = 'all';

/**
 * `type=buy_let,r2r` (or repeated): the known types in the question's order.
 * `type=all` is every type, so it survives the round trip: an empty list is
 * "not chosen here", which Browse fills with the profile's own types.
 */
export function typesParam(v: string | string[] | undefined): DealType[] {
  const list = (Array.isArray(v) ? v : v ? v.split(',') : []).map((x) => x.trim());
  if (list.includes(ALL_TYPES_PARAM)) return [...TYPE_VALUES];
  return TYPE_VALUES.filter((t) => list.includes(t));
}

/**
 * Browse's filters (Batch 17, Q29). With no `type` in the URL: an older
 * `kind=` link keeps meaning what it said (to buy: Buy and let and BRRR;
 * rent-to-rent: Rent-to-rent), and otherwise the profile's own types, every
 * type once all three are chosen. The kind is then folded into the types, so
 * the filter bar shows the one thing the grid is filtered on.
 */
export function browseFilters(parsed: DealFilters, typeInUrl: boolean, profileTypes: readonly DealType[]): DealFilters {
  if (typeInUrl) return parsed;
  if (parsed.kind === 'sale') return { ...parsed, kind: 'both', types: ['buy_let', 'brrr'] };
  if (parsed.kind === 'rent') return { ...parsed, kind: 'both', types: ['r2r'] };
  const own = TYPE_VALUES.filter((t) => profileTypes.includes(t));
  return { ...parsed, types: own.length === TYPE_VALUES.length ? [] : own };
}

/** The listing kind these types cover, for figures kept by kind (the area counts). */
export function kindOfTypes(types: readonly DealType[]): DealKindFilter {
  const sale = types.length === 0 || types.includes('buy_let') || types.includes('brrr');
  const rent = types.length === 0 || types.includes('r2r');
  return sale && rent ? 'both' : rent ? 'rent' : 'sale';
}

/**
 * The deal-types filter as query clauses (Batch 17). A rental is
 * Rent-to-rent; a sale with a Project estimate (marketplace_deals.project) is
 * BRRR; any other sale Buy and let. `projectColumn` false: the schema section
 * has not been run, so there are no Project deals and every sale is Buy and
 * let. `lightOnly`: of the Project deals, the light refreshes only. Null: no
 * filter. `none`: nothing can match.
 */
export type TypeClause = { none: true } | { none?: false; kind?: 'sale' | 'rent'; project?: 'null' | 'not_null' | 'light'; or?: string };

const LIGHT = 'project->>level.eq.light';

export function typeClauseFor(types: readonly DealType[], projectColumn: boolean, lightOnly = false): TypeClause | null {
  const set = new Set(types.length === 0 ? TYPE_VALUES : types);
  const bl = set.has('buy_let');
  const brrr = set.has('brrr') && projectColumn;
  const r2r = set.has('r2r');
  if (!projectColumn) {
    if (bl && r2r) return null;
    if (bl) return { kind: 'sale' };
    if (r2r) return { kind: 'rent' };
    return { none: true };
  }
  const light = brrr && lightOnly;
  if (bl && brrr && r2r) return light ? { or: `project.is.null,${LIGHT}` } : null;
  if (bl && brrr) return light ? { kind: 'sale', or: `project.is.null,${LIGHT}` } : { kind: 'sale' };
  if (bl && r2r) return { project: 'null' };
  if (brrr && r2r) return { or: `kind.eq.rent,${light ? LIGHT : 'project.not.is.null'}` };
  if (bl) return { kind: 'sale', project: 'null' };
  if (brrr) return { kind: 'sale', project: light ? 'light' : 'not_null' };
  return { kind: 'rent' };
}

/** Every value is whitelisted or clamped; junk falls back to the default rather than erroring. */
export function parseDealFilters(raw: Raw): DealFilters {
  const kind = first(raw.kind);
  const beds = first(raw.beds);
  const sort = first(raw.sort);
  const view = first(raw.view);
  const areasRaw = raw.areas ?? raw.area;
  const areaList = (Array.isArray(areasRaw) ? areasRaw : areasRaw ? areasRaw.split(',') : [])
    .map((a) => a.trim().toUpperCase())
    .filter((a) => AREA_CODES.has(a));
  const minPrice = num(raw.minPrice, 0, 50_000_000);
  const maxPrice = num(raw.maxPrice, 0, 50_000_000);
  return {
    kind: kind === 'sale' || kind === 'rent' ? kind : 'both',
    types: typesParam(raw.type),
    areas: [...new Set(areaList)],
    beds: beds === '1' || beds === '2' || beds === '3' || beds === '4+' ? beds : 'any',
    minPrice,
    maxPrice: maxPrice !== null && minPrice !== null && maxPrice < minPrice ? null : maxPrice,
    minProfit: num(raw.minProfit, 0, 10_000_000),
    minUplift: num(raw.minUplift, 0, 10_000),
    sort: sort === 'profit' || sort === 'uplift' || sort === 'newest' || sort === 'price' ? sort : 'best',
    view: view === 'kept' || view === 'passed' ? view : 'all',
    page: num(raw.page, 1, MAX_PAGE) ?? 1,
  };
}

/** Back to a query string, defaults omitted, so links and chips stay short and stable. */
export function filtersToSearch(f: Partial<DealFilters>): string {
  const p = new URLSearchParams();
  if (f.kind && f.kind !== 'both') p.set('kind', f.kind);
  if (f.types && f.types.length > 0) p.set('type', f.types.length >= TYPE_VALUES.length ? ALL_TYPES_PARAM : f.types.join(','));
  if (f.areas && f.areas.length > 0) p.set('areas', f.areas.join(','));
  if (f.beds && f.beds !== 'any') p.set('beds', f.beds);
  if (f.minPrice) p.set('minPrice', String(f.minPrice));
  if (f.maxPrice) p.set('maxPrice', String(f.maxPrice));
  if (f.minProfit) p.set('minProfit', String(f.minProfit));
  if (f.minUplift) p.set('minUplift', String(f.minUplift));
  if (f.sort && f.sort !== 'best') p.set('sort', f.sort);
  if (f.view && f.view !== 'all') p.set('view', f.view);
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

/**
 * What a query that renders a DealCard selects: the public columns plus the
 * card's motivation line inputs, the early-access clock, and the screening's
 * short-let revenue and confidence (two JSON paths: the inputs of the profit
 * range, src/lib/marketplace/profit-range.ts). None of these holds an
 * address; the deal page already shows motivation and the screening to every
 * member. Kept separate from PUBLIC_DEAL_COLUMNS so the cached area teaser
 * (up to 2,000 rows) does not carry them.
 */
export const CARD_COLUMNS = `${PUBLIC_DEAL_COLUMNS}, motivation, price_history, live_since, screening_gross:screening->grossRevenue->>value, screening_confidence:screening->>confidence, deal_setup:deal->>setupCost, deal_breakeven:deal->>breakevenOccupancyPct, deal_payback:deal->>paybackMonths, deal_margin:deal->>monthlyMargin, deal_cash:deal->>cashRequired, deal_auction:deal->auction->>method, check_comps:screening->check->>compCount`;

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
  /** CARD_COLUMNS only: the stored motivation verdict, for the card's motivation line. */
  motivation?: unknown;
  /** CARD_COLUMNS only: our recorded price changes, for "Reduced twice". */
  price_history?: unknown;
  /** CARD_COLUMNS only: when the deal went live, which starts the early-access window. */
  live_since?: string | null;
  /** CARD_COLUMNS only: the screening's short-let revenue for the area and size (£/yr, as text from the JSON path). */
  screening_gross?: string | number | null;
  /** CARD_COLUMNS only: the screening's confidence: high | medium | low. */
  screening_confidence?: string | null;
  /** CARD_COLUMNS only (Batch 14): a rental's stored setup cost (£), break-even occupancy (%), payback (months) and monthly margin (£), as text from the JSON paths. */
  deal_setup?: string | number | null;
  deal_breakeven?: string | number | null;
  deal_payback?: string | number | null;
  deal_margin?: string | number | null;
  /** CARD_COLUMNS only (Batch 16): a purchase's cash in at the house finance (£): deposit, tax and setup, or the bridging cash for an auction lot. */
  deal_cash?: string | number | null;
  /** CARD_COLUMNS only (Batch 16): 'traditional' | 'modern' when the stored deal is an auction lot, else null. */
  deal_auction?: string | null;
  /** CARD_COLUMNS only (Batch 16, Part C): the comparables the deal's own check kept, when it has one (a count, never where). Null on the area's average. */
  check_comps?: string | number | null;
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

/** Sign-aware: "−£500", never "£-500". */
const gbpWhole = (n: number): string => `${Math.round(n) < 0 ? '−' : ''}£${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;

/** "£250,000" or "£1,200 pcm". */
/**
 * An auction lot (Batch 16): the stored motivation verdict carries the
 * 'auction' signal, which src/lib/deal-quality/auction.ts feeds from the
 * portal's flag, the page's wording or PropertyData's auction cohort.
 * "Guide price" on its own never makes a lot. Its price is a guide, not an
 * asking price.
 */
export function isAuctionCard(card: { motivation?: unknown }): boolean {
  const fired = (card.motivation as { fired?: unknown } | null | undefined)?.fired;
  return Array.isArray(fired) && fired.includes('auction');
}

export const AUCTION_LABEL = 'Auction · guide price';

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
  return { big: uplift === null ? '—' : `${Math.round(uplift) < 0 ? '−' : '+'}${Math.abs(Math.round(uplift))}%`, small: profit === null ? 'over a long let' : `${gbpWhole(profit)}/yr over a long let` };
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

/**
 * `widths` (billing_settings.profit_range_pct) turns the figure into the
 * profit range at the house finance (Batch 10): the area block and the
 * public teaser show nobody's own finance. Without it, the old headline.
 */
export function areaDealView(card: DealCard, photoUrl: string | null, now: Date = new Date(), widths?: { high: number; medium: number; low: number }): AreaDealView {
  const badges = badgesFor(card, now);
  const range = widths ? profitRange({ kind: card.kind, priceAmount: card.price_amount, pricePeriod: card.price_period, bedrooms: card.bedrooms, grossRevenue: card.screening_gross ?? null, confidence: card.screening_confidence ?? null, finance: null, widths }) : null;
  const uplift = card.kind === 'sale' ? upliftTag(card.uplift_pct) : null;
  const figure = widths ? { big: range?.label ?? '—', small: [`${rangeCaption(card.check_comps)}${range ? `, ${range.basis}` : ''}`, uplift].filter(Boolean).join(' · ') } : headlineFigure(card);
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
