import 'server-only';

/**
 * What a member is tracking, for alerts and the weekly recap: Batch 5's
 * loadTrackedDeals with scope 'own' ("what an alert about 'your deals'
 * should read"), which applies B5's precedence, its address rule and the
 * early-access window, plus the two things alerts need that My deals does
 * not: each pipeline row's own price history, and when a marketplace deal
 * came back on the market.
 *
 * loadTrackedDeals is per member, so members are read a few at a time. This
 * runs in its own crons (06:55 collector, Monday's Your week), never inside
 * the picks passes.
 */
import type { createAdminClient } from '../supabase/admin';
import { loadTrackedDeals, type TrackedLoad } from '../listing/tracked-server';
import { parseHistory, type PriceHistoryEntry } from '../listing/recheck';
import { describeType } from '../marketplace/grid';
import { mapLimit } from './daily-server';
import { placeOf, type Link } from './message';

type Admin = ReturnType<typeof createAdminClient>;

const ID_CHUNK = 150;

export interface MemberTracking {
  load: TrackedLoad;
  pipelineHistory: Map<string, PriceHistoryEntry[]>;
  revived: Map<string, { at: string; from: string | null }>;
}

export async function trackingFor(admin: Admin, members: readonly { id: string; admin: boolean }[], concurrency = 6): Promise<Map<string, MemberTracking>> {
  const out = new Map<string, MemberTracking>();
  const loads = await mapLimit(members, concurrency, (m) =>
    loadTrackedDeals(m.id, { scope: 'own', adminUser: m.admin }).catch((err) => {
      console.error('[notify] tracked read failed:', (err as Error)?.message ?? err);
      return null;
    }),
  );
  const rowIds = new Set<string>();
  const dealIds = new Set<string>();
  for (const l of loads) {
    for (const v of l?.view ?? []) {
      if (v.checkedListingId) rowIds.add(v.checkedListingId);
      if (v.dealId) dealIds.add(v.dealId);
    }
  }
  const histories = new Map<string, PriceHistoryEntry[]>();
  const rows = [...rowIds];
  for (let i = 0; i < rows.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('checked_listings').select('id, price_history').in('id', rows.slice(i, i + ID_CHUNK));
    if (error) console.warn('[notify] pipeline history read failed:', error.message);
    for (const r of (data ?? []) as { id: string; price_history: unknown }[]) histories.set(r.id, parseHistory(r.price_history));
  }
  const revived = new Map<string, { at: string; from: string | null }>();
  const deals = [...dealIds];
  for (let i = 0; i < deals.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('marketplace_deals').select('id, revived_at, revived_from').in('id', deals.slice(i, i + ID_CHUNK)).not('revived_at', 'is', null);
    if (error) {
      // The schema has not been run yet: nothing has been revived as far as alerts know.
      console.warn('[notify] revived read failed (schema behind?):', error.message);
      break;
    }
    for (const r of (data ?? []) as { id: string; revived_at: string; revived_from: string | null }[]) revived.set(r.id, { at: r.revived_at, from: r.revived_from });
  }
  members.forEach((m, i) => {
    const load = loads[i];
    if (!load) return;
    const mine = new Map<string, PriceHistoryEntry[]>();
    for (const v of load.view) if (v.checkedListingId && histories.has(v.checkedListingId)) mine.set(v.checkedListingId, histories.get(v.checkedListingId)!);
    out.set(m.id, { load, pipelineHistory: mine, revived });
  });
  return out;
}

/** Which deal, in words the member may see: the address only when they opened it (B5's rule), else town and type. */
export function trackedPlace(t: MemberTracking, v: TrackedLoad['view'][number]): string {
  if (v.opened) {
    const address = v.listing?.address ?? (v.dealId ? t.load.addresses.get(v.dealId) : null);
    if (address && address.trim()) return address.trim();
  }
  const card = v.dealId ? t.load.cards.get(v.dealId) : undefined;
  if (card) return [placeOf(card), describeType(card)].filter(Boolean).join(' · ') || 'A deal you track';
  return v.listing?.title ?? 'A deal you track';
}

export function trackedLink(v: TrackedLoad['view'][number], siteUrl: string): Link {
  return { label: 'Open in My deals', url: `${siteUrl.replace(/\/$/, '')}/my-deals?focus=${encodeURIComponent(v.key)}` };
}
