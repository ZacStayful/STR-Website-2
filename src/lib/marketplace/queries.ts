import 'server-only';

/**
 * What the marketplace pages read: the grid, the per-area counts for the map
 * and the teaser pages, and the signed photo URL. Service role, because the
 * tables have no member policies; every query here is scoped to what a
 * member may see (PUBLIC_DEAL_COLUMNS, status = live, and for accounts that
 * have never paid only deals live since before the cutoff — see
 * visibility.ts) and never returns the listing URL, address or postcode.
 *
 * Every reader takes the cutoff as an argument rather than looking it up, so
 * the two cached readers key their cache on it (unstable_cache keys on the
 * arguments) and a paid and a free request can never share an entry.
 */
import { unstable_cache } from 'next/cache';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { PAGE_SIZE, PUBLIC_DEAL_COLUMNS, areaDealView, type AreaDealsSummary, type DealCard, type DealFilters, type DealKindFilter } from './grid';
import { expiringPayload, signPayload, signingConfigured } from '../crypto/sign';
import { DEALS_TAG } from './server';
import type { DealVisibility } from './visibility';

export interface DealPage {
  cards: DealCard[];
  total: number;
  page: number;
  pages: number;
}

const EMPTY: DealPage = { cards: [], total: 0, page: 1, pages: 0 };

export async function listDeals(f: DealFilters, visibility: DealVisibility): Promise<DealPage> {
  if (!hasServiceRole()) return EMPTY;
  const admin = createAdminClient();
  let q = admin.from('marketplace_deals').select(`${PUBLIC_DEAL_COLUMNS}, photo`, { count: 'exact' }).eq('status', 'live');
  if (visibility.cutoffIso) q = q.lte('live_since', visibility.cutoffIso);
  if (f.kind !== 'both') q = q.eq('kind', f.kind);
  if (f.areas.length > 0) q = q.in('postcode_area', f.areas);
  if (f.beds === '4+') q = q.gte('bedrooms', 4);
  else if (f.beds !== 'any') q = q.eq('bedrooms', Number(f.beds));
  if (f.minPrice !== null) q = q.gte('price_amount', f.minPrice);
  if (f.maxPrice !== null) q = q.lte('price_amount', f.maxPrice);
  if (f.minProfit !== null) q = q.gte('annual_profit', f.minProfit);
  // Rentals carry no uplift figure, so an uplift floor only ever narrows sales.
  if (f.minUplift !== null && f.kind === 'sale') q = q.gte('uplift_pct', f.minUplift);
  switch (f.sort) {
    case 'uplift':
      q = q.order('uplift_pct', { ascending: false, nullsFirst: false }).order('annual_profit', { ascending: false, nullsFirst: false });
      break;
    case 'newest':
      q = q.order('first_seen_at', { ascending: false });
      break;
    case 'price':
      q = q.order('price_amount', { ascending: true, nullsFirst: false });
      break;
    default:
      q = q.order('annual_profit', { ascending: false, nullsFirst: false });
  }
  q = q.order('canonical_url', { ascending: true });
  const from = (f.page - 1) * PAGE_SIZE;
  const { data, error, count } = await q.range(from, from + PAGE_SIZE - 1);
  if (error) {
    console.error('[marketplace] listDeals failed:', error.message);
    return EMPTY;
  }
  const total = count ?? 0;
  const cards = ((data ?? []) as unknown as (DealCard & { photo: string | null })[]).map(({ photo, ...card }) => ({ ...card, has_photo: Boolean(photo) }));
  return { cards, total, page: f.page, pages: Math.ceil(total / PAGE_SIZE) };
}

export interface AreaCount {
  code: string;
  sale: number;
  rent: number;
  total: number;
}

async function countsByAreaUncached(cutoffIso: string | null): Promise<AreaCount[]> {
  if (!hasServiceRole()) return [];
  const admin = createAdminClient();
  const PAGE = 1000;
  const byArea = new Map<string, AreaCount>();
  for (let from = 0; ; from += PAGE) {
    let q = admin.from('marketplace_deals').select('postcode_area, kind').eq('status', 'live');
    if (cutoffIso) q = q.lte('live_since', cutoffIso);
    const { data, error } = await q.order('canonical_url', { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      console.error('[marketplace] area counts failed:', error.message);
      break;
    }
    for (const r of (data ?? []) as { postcode_area: string | null; kind: string }[]) {
      if (!r.postcode_area) continue;
      const c = byArea.get(r.postcode_area) ?? { code: r.postcode_area, sale: 0, rent: 0, total: 0 };
      if (r.kind === 'rent') c.rent += 1;
      else c.sale += 1;
      c.total += 1;
      byArea.set(r.postcode_area, c);
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return [...byArea.values()].sort((a, b) => b.total - a.total);
}

/**
 * Live deals per area, cached for five minutes and invalidated by every sweep,
 * recheck and admin retire. Pass `visibility.hourCutoffIso`: null for a paying
 * account (one entry), the hour-floored cutoff for everyone else (one entry
 * per hour, so a free account sees a deal 48–49 hours after it went live).
 */
export const liveCountsByArea = unstable_cache(countsByAreaUncached, ['marketplace-area-counts'], { revalidate: 300, tags: [DEALS_TAG] });

export function countFor(counts: AreaCount[], code: string, kind: DealKindFilter): number {
  const c = counts.find((x) => x.code === code);
  if (!c) return 0;
  return kind === 'sale' ? c.sale : kind === 'rent' ? c.rent : c.total;
}

const SHOWN_THROTTLE_MS = 60 * 60 * 1000;

/**
 * Marks the deals a member's grid just showed, so the recheck looks at what
 * members are looking at before the tail. Throttled to once an hour per deal
 * so a busy grid does not write on every render.
 */
export async function recordShown(ids: string[]): Promise<void> {
  if (!hasServiceRole() || ids.length === 0) return;
  const cutoff = new Date(Date.now() - SHOWN_THROTTLE_MS).toISOString();
  const nowIso = new Date().toISOString();
  const admin = createAdminClient();
  const { error } = await admin.from('marketplace_deals').update({ last_shown_at: nowIso }).in('id', ids).or(`last_shown_at.is.null,last_shown_at.lt.${cutoff}`);
  if (error) console.error('[marketplace] recordShown failed:', error.message);
}

const DAY_S = 24 * 60 * 60;

/**
 * The signed URL a card loads its photo from, valid for the rest of today
 * and all of tomorrow so the CDN sees the same URL across renders. Null when
 * no signing key is configured or the deal has no photo.
 */
export function photoUrlFor(card: Pick<DealCard, 'id' | 'has_photo'>, now: Date = new Date()): string | null {
  if (!card.has_photo || !signingConfigured()) return null;
  const exp = (Math.floor(now.getTime() / 1000 / DAY_S) + 2) * DAY_S;
  const sig = signPayload(expiringPayload(card.id, exp));
  return sig ? `/api/deals/photo?id=${encodeURIComponent(card.id)}&exp=${exp}&sig=${sig}` : null;
}

/** Which of these deals the member has already opened (status open), so the card can say so. */
export async function openedDealIds(userId: string, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!hasServiceRole() || ids.length === 0) return out;
  const { data, error } = await createAdminClient().from('deal_opens').select('deal_id').eq('user_id', userId).eq('status', 'open').in('deal_id', ids);
  if (error) {
    console.error('[marketplace] openedDealIds failed:', error.message);
    return out;
  }
  for (const r of (data ?? []) as { deal_id: string }[]) out.add(r.deal_id);
  return out;
}

// ── Public teaser pages ──

export interface AreaTeaser {
  code: string;
  sale: number;
  rent: number;
  total: number;
  /** Median annual profit across live deals, £. */
  medianProfit: number | null;
  /** The three best live deals, public columns only. */
  top: DealCard[];
  area: { name: string; slug: string; score: number | null; occupancy: number | null; adr: number | null } | null;
}

async function teaserUncached(code: string, cutoffIso: string | null): Promise<AreaTeaser | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  let q = admin.from('marketplace_deals').select(`${PUBLIC_DEAL_COLUMNS}, photo`).eq('status', 'live').eq('postcode_area', code);
  if (cutoffIso) q = q.lte('live_since', cutoffIso);
  const { data, error } = await q.order('annual_profit', { ascending: false, nullsFirst: false }).limit(2000);
  if (error) {
    console.error('[marketplace] teaser failed:', error.message);
    return null;
  }
  const rows = ((data ?? []) as unknown as (DealCard & { photo: string | null })[]).map(({ photo, ...card }) => ({ ...card, has_photo: Boolean(photo) }));
  const profits = rows.map((r) => (r.annual_profit === null ? null : Number(r.annual_profit))).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const median = profits.length === 0 ? null : profits[Math.floor(profits.length / 2)];
  const { getAreaCards } = await import('../market/cached');
  const card = (await getAreaCards().catch(() => [])).find((c) => c.code === code) ?? null;
  const { areaMetaForCode } = await import('../market/areas');
  const meta = areaMetaForCode(code);
  return {
    code,
    sale: rows.filter((r) => r.kind === 'sale').length,
    rent: rows.filter((r) => r.kind === 'rent').length,
    total: rows.length,
    medianProfit: median,
    top: rows.slice(0, 3),
    area: { name: meta.name, slug: meta.slug, score: card?.score?.score ?? null, occupancy: card?.headline.occupancy ?? null, adr: card?.headline.adr ?? null },
  };
}

/** One area's teaser, cached for an hour and invalidated with the pool. Takes `visibility.hourCutoffIso`, as liveCountsByArea does. */
export const teaserForArea = unstable_cache(teaserUncached, ['marketplace-area-teaser'], { revalidate: 3600, tags: [DEALS_TAG] });

/**
 * The Market Explorer's "deals on the market here" block: counts, the median
 * profit and the top three deals, formatted and with signed photo URLs. The
 * cached teaser is shared with the public area page; the photo signatures
 * are day-scoped so they are added outside the cache.
 */
export async function marketDealsForArea(code: string, visibility: DealVisibility, now: Date = new Date()): Promise<AreaDealsSummary | null> {
  const t = await teaserForArea(code, visibility.hourCutoffIso).catch((err) => {
    console.error('[marketplace] marketDealsForArea failed:', (err as Error)?.message ?? err);
    return null;
  });
  if (!t) return null;
  return { code: t.code, sale: t.sale, rent: t.rent, total: t.total, medianProfit: t.medianProfit, top: t.top.map((c) => areaDealView(c, photoUrlFor(c, now), now)) };
}
