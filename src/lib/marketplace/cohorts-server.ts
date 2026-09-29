import 'server-only';

/**
 * The motivated-seller cohorts (PropertyData's long-on-market, reduced and
 * repossessed lists) from the weekly cache, for a record rebuilt away from
 * the sweep: the entry page read (applyLiveResult), Batch 16's comparables
 * check and the Project prep. Without them the rebuild dropped every signal
 * only a cohort can give (Batch 17, bug 1: "cohort signals wiped at the
 * first live check"). Read-only: it never buys a cohort; the sweep does.
 *
 * One cache read per area per run, whatever the number of deals.
 */
import type { createAdminClient } from '../supabase/admin';
import { indexCohorts, lookupCohorts, type CohortMember } from '../listing/cohorts';
import { queryKeyArea } from '../listing/sourcing';

type Admin = ReturnType<typeof createAdminClient>;

/** A cached cohort older than this is not used (the sweep buys a fresh one weekly). */
export const COHORT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CohortLookup {
  /**
   * The cohort member for a listing, from its area's cached cohorts; null
   * when none is cached or it is not in one. Given the listing's URL, a miss
   * also tries the area whose search found it: the sweep matched a listing
   * against the cohorts of the areas it searched, so one found through a
   * neighbouring area's search can sit in that area's cohort.
   */
  find(listing: { postcodeArea?: string | null; uprn?: string | null; postcode?: string | null; address?: string | null }, fallbackArea?: string | null, url?: string | null): Promise<CohortMember | null>;
}


export function cachedCohortLookup(admin: Admin, now: () => number = Date.now): CohortLookup {
  const index = new Map<string, CohortMember>();
  const loaded = new Map<string, Promise<void>>();
  const load = (area: string): Promise<void> => {
    const hit = loaded.get(area);
    if (hit) return hit;
    const p = (async () => {
      const { data, error } = await admin.from('marketplace_cohorts').select('payload, fetched_at').eq('postcode_area', area).maybeSingle();
      if (error || !data) return;
      const row = data as { payload: unknown; fetched_at: string };
      if (now() - new Date(String(row.fetched_at)).getTime() >= COHORT_MAX_AGE_MS) return;
      const members = Array.isArray(row.payload) ? (row.payload as CohortMember[]) : [];
      // The first area to claim a key keeps it, as in the sweep's own index.
      for (const [k, v] of indexCohorts(members)) if (!index.has(k)) index.set(k, v);
    })().catch((err) => console.warn('[marketplace] cohort cache read failed:', (err as Error)?.message ?? err));
    loaded.set(area, p);
    return p;
  };
  const match = (listing: { uprn?: string | null; postcode?: string | null; address?: string | null }) => lookupCohorts(index, { uprn: listing.uprn ?? null, postcode: listing.postcode ?? null, address: listing.address ?? null });
  return {
    async find(listing, fallbackArea, url) {
      const area = listing.postcodeArea ?? fallbackArea ?? null;
      if (area) await load(area);
      const hit = match(listing);
      if (hit || !url) return hit;
      const { data, error } = await admin.from('sourced_listings').select('query_key').eq('canonical_url', url).maybeSingle();
      const searched = error ? null : queryKeyArea((data as { query_key?: string } | null)?.query_key);
      if (!searched || searched === area) return null;
      await load(searched);
      return match(listing);
    },
  };
}
