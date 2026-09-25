import 'server-only';

/**
 * What the marketplace pages read: the grid, the per-area counts for the map
 * and the teaser pages, and the signed photo URL. Service role, because the
 * tables have no member policies; every query here is scoped to what a
 * member may see (PUBLIC_DEAL_COLUMNS, status = live) and never returns the
 * listing URL, address or postcode.
 */
import { unstable_cache } from 'next/cache';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { PAGE_SIZE, PUBLIC_DEAL_COLUMNS, type DealCard, type DealFilters, type DealKindFilter } from './grid';
import { expiringPayload, signPayload, signingConfigured } from '../crypto/sign';
import { DEALS_TAG } from './server';

export interface DealPage {
  cards: DealCard[];
  total: number;
  page: number;
  pages: number;
}

const EMPTY: DealPage = { cards: [], total: 0, page: 1, pages: 0 };

export async function listDeals(f: DealFilters): Promise<DealPage> {
  if (!hasServiceRole()) return EMPTY;
  const admin = createAdminClient();
  let q = admin.from('marketplace_deals').select(`${PUBLIC_DEAL_COLUMNS}, photo`, { count: 'exact' }).eq('status', 'live');
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

async function countsByAreaUncached(): Promise<AreaCount[]> {
  if (!hasServiceRole()) return [];
  const admin = createAdminClient();
  const PAGE = 1000;
  const byArea = new Map<string, AreaCount>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('marketplace_deals').select('postcode_area, kind').eq('status', 'live').order('canonical_url', { ascending: true }).range(from, from + PAGE - 1);
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

/** Live deals per area, cached for five minutes and invalidated by every sweep, recheck and admin retire. */
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
