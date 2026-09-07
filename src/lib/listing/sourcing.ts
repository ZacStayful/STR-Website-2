/**
 * Deal sourcing: pure helpers behind the daily digest. The cron route asks
 * the broker for listings per query, this module turns goals into queries,
 * portal search results into listings, listings into quick deals, and the
 * ranked picks into an email. Nothing here touches the network.
 */
import type { ListingSource } from './types.ts';
import type { Deal, FinanceDefaults } from './deal.ts';
import { purchaseDeal, rentToRentDeal, DEFAULT_FINANCE } from './deal.ts';
import { detectListingUrl, SERVER_FETCHABLE } from './detect.ts';
import { escapeHtml as esc } from '../email/escape.ts';
import { scriptJsonById, parsePrice, findPostcode, findOutcode } from './html.ts';
import { formatListingPrice } from './format.ts';
import { postcodeAreaOf } from './normalise.ts';
import { blendFit } from './pipeline.ts';
import type { MarketGoals } from '../market/goals.ts';
import { haversineMiles } from '../market/geo.ts';
import type { PmiListingsResponse } from '../broker/providers/pmi.ts';

export type SourcingKind = 'sale' | 'rent';

export interface SourcedListing {
  source: ListingSource;
  id: string;
  canonicalUrl: string;
  kind: SourcingKind;
  title: string;
  address: string | null;
  postcode: string | null;
  outcode: string | null;
  postcodeArea: string | null;
  lat: number | null;
  lng: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  price: { amount: number; period: 'total' | 'pcm' | 'pw' } | null;
  rawType: string | null;
  photo: string | null;
}

export interface SourcingQuery {
  key: string;
  kind: SourcingKind;
  area: string;
  areaName: string;
  areaSlug: string;
  minPrice: number | null;
  maxPrice: number | null;
  minBedrooms: number | null;
}

/** Purchase budget band → price bounds. Rent queries carry no price bound. */
export function budgetBounds(budget: MarketGoals['budget']): { min: number | null; max: number | null } {
  switch (budget) {
    case 'u200':
      return { min: null, max: 200_000 };
    case '200-350':
      return { min: 200_000, max: 350_000 };
    case '350-500':
      return { min: 350_000, max: 500_000 };
    case '500+':
      return { min: 500_000, max: null };
    default:
      return { min: null, max: null };
  }
}

export interface AreaRef {
  code: string;
  name: string;
  slug: string;
  centroid: { lat: number; lng: number } | null;
  /** The member's personal fit (or the Stayful score) used to pick the best few areas. */
  fit: number | null;
}

export const MAX_AREAS_PER_MEMBER = 5;

/**
 * Which areas a member's goals cover: their saved areas plus any area whose
 * centroid is within their distance limit of home, best fit first, capped so
 * a member with a wide radius does not fan out into dozens of searches.
 */
export function areasForGoals(goals: MarketGoals, savedAreas: string[], areas: AreaRef[], limit = MAX_AREAS_PER_MEMBER): AreaRef[] {
  const byCode = new Map(areas.map((a) => [a.code.toUpperCase(), a]));
  const picked = new Map<string, AreaRef>();
  for (const code of savedAreas) {
    const a = byCode.get(code.toUpperCase());
    if (a) picked.set(a.code, a);
  }
  const home = goals.home && goals.home.lat !== null && goals.home.lng !== null ? { lat: goals.home.lat, lng: goals.home.lng } : null;
  if (home && goals.maxDistanceMiles) {
    const near = areas
      .filter((a) => a.centroid && haversineMiles(home, a.centroid) <= goals.maxDistanceMiles!)
      .sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));
    for (const a of near) picked.set(a.code, a);
  }
  return [...picked.values()].sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1)).slice(0, limit);
}

export function queryKey(kind: SourcingKind, area: string, minPrice: number | null, maxPrice: number | null, minBedrooms: number | null): string {
  return `${kind}|${area.toUpperCase()}|${minPrice ?? ''}|${maxPrice ?? ''}|${minBedrooms ?? ''}`;
}

/** The searches one member's goals translate into (shared across members by key). */
export function queriesForGoals(goals: MarketGoals, savedAreas: string[], areas: AreaRef[]): SourcingQuery[] {
  const kinds: SourcingKind[] = goals.sourcingKind === 'both' ? ['sale', 'rent'] : [goals.sourcingKind];
  const minBedrooms = goals.bedrooms ?? null;
  const bounds = budgetBounds(goals.budget);
  const out: SourcingQuery[] = [];
  for (const a of areasForGoals(goals, savedAreas, areas)) {
    for (const kind of kinds) {
      const minPrice = kind === 'sale' ? bounds.min : null;
      const maxPrice = kind === 'sale' ? bounds.max : null;
      out.push({ key: queryKey(kind, a.code, minPrice, maxPrice, minBedrooms), kind, area: a.code, areaName: a.name, areaSlug: a.slug, minPrice, maxPrice, minBedrooms });
    }
  }
  return out;
}

// ── OnTheMarket search pages ──

/** Only areas with a real city slug can be searched; the generated fallback slug is the code itself. */
export function onTheMarketSearchUrl(q: SourcingQuery): string | null {
  if (!q.areaSlug || q.areaSlug.toLowerCase() === q.area.toLowerCase()) return null;
  const u = new URL(`https://www.onthemarket.com/${q.kind === 'rent' ? 'to-rent' : 'for-sale'}/property/${encodeURIComponent(q.areaSlug)}/`);
  if (q.maxPrice) u.searchParams.set('max-price', String(q.maxPrice));
  if (q.minPrice) u.searchParams.set('min-price', String(q.minPrice));
  if (q.minBedrooms) u.searchParams.set('min-bedrooms', String(q.minBedrooms));
  u.searchParams.set('radius', '5');
  return u.toString();
}

interface OtmCard {
  id?: unknown;
  address?: unknown;
  'property-title'?: unknown;
  'humanised-property-type'?: unknown;
  price?: unknown;
  bedrooms?: unknown;
  bathrooms?: unknown;
  location?: { lat?: unknown; lon?: unknown };
  'cover-image'?: { default?: unknown };
  'details-url'?: unknown;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Cards from an OnTheMarket results page (`__NEXT_DATA__` → initialReduxState.results.list). */
export function parseOnTheMarketSearch(html: string, kind: SourcingKind): SourcedListing[] {
  const nd = scriptJsonById(html, '__NEXT_DATA__') as { props?: { initialReduxState?: { results?: { list?: unknown } } } } | null;
  const list = nd?.props?.initialReduxState?.results?.list;
  if (!Array.isArray(list)) return [];
  const out: SourcedListing[] = [];
  for (const raw of list as OtmCard[]) {
    const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : null;
    if (!id || !/^\d+$/.test(id)) continue;
    const address = str(raw.address);
    const pc = findPostcode(address);
    const outcode = pc?.outcode ?? findOutcode(address);
    const priceRaw = parsePrice(str(raw.price));
    const price = priceRaw && priceRaw.period !== 'night' ? { amount: priceRaw.amount, period: priceRaw.period } : null;
    const cover = raw['cover-image']?.default;
    out.push({
      source: 'onthemarket',
      id,
      canonicalUrl: `https://www.onthemarket.com/details/${id}/`,
      kind,
      title: str(raw['property-title']) ?? address ?? `OnTheMarket listing ${id}`,
      address,
      postcode: pc?.postcode ?? null,
      outcode,
      postcodeArea: postcodeAreaOf(outcode),
      lat: num(raw.location?.lat),
      lng: num(raw.location?.lon),
      bedrooms: num(raw.bedrooms),
      bathrooms: num(raw.bathrooms),
      price,
      rawType: str(raw['humanised-property-type']),
      photo: str(cover),
    });
  }
  return out;
}

// ── Property Market Intel /listings ──

/**
 * PMI listings carry the portal URL; only ones we can canonicalise AND fetch
 * ourselves are usable, because every link in the digest (full report, add
 * to pipeline) goes through the server-side resolve.
 */
export function fromPmiListings(resp: PmiListingsResponse | null, kind: SourcingKind): SourcedListing[] {
  if (!resp || !Array.isArray(resp.listings)) return [];
  const out: SourcedListing[] = [];
  for (const l of resp.listings) {
    const detected = l.url ? detectListingUrl(l.url) : null;
    if (!detected || !SERVER_FETCHABLE.has(detected.source)) continue;
    const pc = findPostcode(l.postcode ?? l.address ?? null);
    const outcode = pc?.outcode ?? findOutcode(l.postcode ?? l.address ?? null);
    const amount = typeof l.price === 'number' && l.price > 0 ? l.price : null;
    out.push({
      source: detected.source,
      id: detected.id,
      canonicalUrl: detected.canonicalUrl,
      kind,
      title: l.address ?? `${detected.source} listing ${detected.id}`,
      address: l.address ?? null,
      postcode: pc?.postcode ?? null,
      outcode,
      postcodeArea: postcodeAreaOf(outcode),
      lat: null,
      lng: null,
      bedrooms: typeof l.bedrooms === 'number' ? l.bedrooms : null,
      bathrooms: null,
      price: amount ? { amount, period: kind === 'rent' ? 'pcm' : 'total' } : null,
      rawType: l.property_type ?? null,
      photo: null,
    });
  }
  return out;
}

// ── Quick deal on area figures ──

export interface AreaFigures {
  /** Per-bedroom stats when the area has them: bedrooms → gross revenue / ADR. */
  byBedrooms: { bedrooms: number; grossRevenue: number | null; adr: number | null }[];
  headline: { grossRevenue: number | null; adr: number | null };
}

/** The best area-level revenue figure for this listing's size, or null when the area has none. */
export function areaRevenueFor(figures: AreaFigures, bedrooms: number | null): { grossRevenue: number; adr: number } | null {
  const bs = bedrooms ? figures.byBedrooms.find((b) => b.bedrooms === bedrooms) : undefined;
  const rev = bs?.grossRevenue ?? figures.headline.grossRevenue;
  if (!rev || rev <= 0) return null;
  return { grossRevenue: rev, adr: bs?.adr ?? figures.headline.adr ?? 0 };
}

export function dealForSourced(listing: SourcedListing, figures: AreaFigures | null, finance: Partial<FinanceDefaults> | null): Deal | null {
  if (!figures || !listing.price) return null;
  const rev = areaRevenueFor(figures, listing.bedrooms);
  if (!rev) return null;
  const base = { grossRevenue: rev.grossRevenue, adr: rev.adr, bedrooms: listing.bedrooms ?? 2, finance: { ...DEFAULT_FINANCE, ...(finance ?? {}) } };
  if (listing.kind === 'sale') return listing.price.period === 'total' ? purchaseDeal(listing.price.amount, base) : null;
  const pcm = listing.price.period === 'pcm' ? listing.price.amount : listing.price.period === 'pw' ? (listing.price.amount * 52) / 12 : null;
  return pcm ? rentToRentDeal(Math.round(pcm), base) : null;
}

export interface SourcedPick {
  listing: SourcedListing;
  deal: Deal | null;
  areaFit: number | null;
  areaName: string;
  fit: number;
}

/** Ranks candidates for one member, dropping anything without a deal and anything losing money. */
export function rankPicks(candidates: { listing: SourcedListing; deal: Deal | null; areaFit: number | null; areaName: string }[], limit = 5): SourcedPick[] {
  const out: SourcedPick[] = [];
  for (const c of candidates) {
    if (!c.deal) continue;
    if (c.deal.kind === 'rent-to-rent' && c.deal.monthlyMargin <= 0) continue;
    if (c.deal.kind === 'purchase' && c.deal.grossYieldPct <= 0) continue;
    const fit = blendFit(c.deal, c.areaFit);
    if (fit === null) continue;
    out.push({ ...c, fit });
  }
  return out.sort((a, b) => b.fit - a.fit || dealScore(b.deal) - dealScore(a.deal)).slice(0, limit);
}

function dealScore(d: Deal | null): number {
  if (!d) return -Infinity;
  return d.kind === 'purchase' ? d.grossYieldPct : d.monthlyMargin;
}

export function describeDeal(d: Deal): string {
  const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
  if (d.kind === 'purchase') return `est. ${gbp(d.grossRevenue)}/yr · ${d.grossYieldPct.toFixed(1)}% gross yield · ${gbp(d.cashflowMonthly)}/mo after mortgage`;
  return `est. ${gbp(d.grossRevenue)}/yr · ${gbp(d.monthlyMargin)}/mo margin after rent · breakeven ${d.breakevenOccupancyPct === null ? 'n/a' : `${Math.round(d.breakevenOccupancyPct)}% occupancy`}`;
}

export function sourcingEmail(picks: SourcedPick[], siteUrl: string): { subject: string; text: string; html: string } {
  const subject = picks.length === 1 ? `1 new listing that fits your goals: ${picks[0].areaName}` : `${picks.length} new listings that fit your goals`;
  const label = (p: SourcedPick) => {
    const l = p.listing;
    const bits = [l.bedrooms ? `${l.bedrooms}-bed` : null, l.rawType, formatListingPrice(l.price)].filter(Boolean);
    return `${l.address ?? l.title} — ${bits.join(' · ')}`;
  };
  const analyse = (p: SourcedPick) => `${siteUrl}/estimate?listing=${encodeURIComponent(p.listing.canonicalUrl)}`;
  const pipeline = (p: SourcedPick) => `${siteUrl}/markets?check=${encodeURIComponent(p.listing.canonicalUrl)}`;
  const text = [
    'New listings from Stayful that fit your goals.',
    '',
    ...picks.map((p) => `• ${label(p)}\n  ${p.deal ? describeDeal(p.deal) : ''} · fit ${p.fit}/100 (${p.areaName})\n  Full report: ${analyse(p)}\n  Add to pipeline: ${pipeline(p)}\n  Listing: ${p.listing.canonicalUrl}`),
    '',
    'Figures are area averages for the size of property; run a full report before acting on one.',
    `Turn sourcing emails off under “Edit goals” in the explorer: ${siteUrl}/markets`,
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#2e3d2b;max-width:560px">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5d8156;font-weight:600">Stayful Deal Sourcing</p>
      <h1 style="font-size:22px;margin:0 0 14px">${esc(subject)}</h1>
      <ol style="padding-left:18px">${picks
        .map(
          (p) =>
            `<li style="margin:12px 0"><strong>${esc(label(p))}</strong><br><span style="color:#5d8156">${esc(p.deal ? describeDeal(p.deal) : '')}</span><br><span style="color:#7a8274;font-size:13px">Fit ${p.fit}/100 · ${esc(p.areaName)}</span><br><a href="${esc(analyse(p))}" style="color:#2e3d2b;font-weight:600">Full report</a> · <a href="${esc(pipeline(p))}" style="color:#2e3d2b">Add to pipeline</a> · <a href="${esc(p.listing.canonicalUrl)}" style="color:#7a8274">View listing</a></li>`,
        )
        .join('')}</ol>
      <p style="color:#7a8274;font-size:12px">Figures are area averages for the size of property; run a full report before acting on one. You get this because deal sourcing is on in your goals. Turn it off under “Edit goals” in the <a href="${esc(`${siteUrl}/markets`)}" style="color:#7a8274">Market Explorer</a>.</p>
    </div>`.trim();
  return { subject, text, html };
}
