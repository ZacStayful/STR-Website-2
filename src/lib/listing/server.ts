import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { createSupabaseServerClient } from '../supabase/server';
import { detectListingUrl, SERVER_FETCHABLE, SOURCE_LABELS } from './detect';
import { parseListing, PARSER_VERSIONS } from './parsers/index';
import { fetchListingHtml } from './fetch';
import { reverseGeocode } from '../apis/geocode';
import { snapshotToPrefill, postcodeAreaOf, type NormaliseResult } from './normalise';
import type { DetectedListing, ListingSnapshot } from './types';
import type { QuickEstimate } from './quick-types';

const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

export type ResolveOutcome =
  | { ok: true; detected: DetectedListing; snapshot: ListingSnapshot; prefill: NormaliseResult['prefill']; warnings: string[]; fromCache: boolean }
  | { ok: false; code: 'unsupported_url' | 'needs_extension' | 'blocked' | 'not_found' | 'unreadable' | 'paused' | 'disabled'; message: string; detected: DetectedListing | null };

function hasServiceRole(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function readSnapshot(canonicalUrl: string): Promise<ListingSnapshot | null> {
  if (!hasServiceRole()) return null;
  const { data } = await createAdminClient().from('listing_snapshots').select('snapshot, expires_at').eq('canonical_url', canonicalUrl).maybeSingle();
  if (!data || new Date(data.expires_at as string).getTime() < Date.now()) return null;
  return data.snapshot as ListingSnapshot;
}

async function writeSnapshot(snap: ListingSnapshot): Promise<void> {
  if (!hasServiceRole()) return;
  const { error } = await createAdminClient()
    .from('listing_snapshots')
    .upsert({ canonical_url: snap.canonicalUrl, source: snap.source, snapshot: snap, fetched_at: snap.fetchedAt, expires_at: new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString() }, { onConflict: 'canonical_url' });
  if (error) console.error('[listing] snapshot write failed:', error.message);
}

/**
 * Turns a pasted URL into a snapshot + analyser prefill. `html` is supplied
 * by the browser extension (Part 2) for sites we cannot fetch ourselves.
 */
export async function resolveListing(url: string, opts: { html?: string; refresh?: boolean } = {}): Promise<ResolveOutcome> {
  const detected = detectListingUrl(url);
  if (!detected) return { ok: false, code: 'unsupported_url', message: 'That does not look like a Rightmove, OnTheMarket, Zoopla, Airbnb or Booking.com listing page.', detected: null };

  const cached = opts.refresh || opts.html ? null : await readSnapshot(detected.canonicalUrl).catch(() => null);
  let snapshot = cached;
  if (!snapshot) {
    let html = opts.html ?? null;
    if (!html) {
      if (!SERVER_FETCHABLE.has(detected.source)) {
        return { ok: false, code: 'needs_extension', message: `${SOURCE_LABELS[detected.source]} blocks automated access. The Stayful browser extension (coming soon) reads the page for you; for now, enter the details manually.`, detected };
      }
      const fetched = await fetchListingHtml(detected.source, detected.canonicalUrl);
      if (!fetched.ok) {
        const map: Record<string, ResolveOutcome & { ok: false }> = {
          not_found: { ok: false, code: 'not_found', message: 'That listing seems to have been removed.', detected },
          paused: { ok: false, code: 'paused', message: `${SOURCE_LABELS[detected.source]} is temporarily unavailable to us. Enter the details manually for now.`, detected },
          disabled: { ok: false, code: 'disabled', message: `Fetching from ${SOURCE_LABELS[detected.source]} is switched off. Enter the details manually.`, detected },
        };
        return map[fetched.reason] ?? { ok: false, code: 'blocked', message: `${SOURCE_LABELS[detected.source]} did not let us read that page. Enter the details manually for now.`, detected };
      }
      html = fetched.html;
    }
    snapshot = parseListing(detected.source, html, { id: detected.id, canonicalUrl: detected.canonicalUrl });
    if (!snapshot) {
      console.error(`[listing] ${detected.source} parser v${PARSER_VERSIONS[detected.source]} could not read ${detected.canonicalUrl}`);
      return { ok: false, code: 'unreadable', message: 'We could not read that listing page. Enter the details manually.', detected };
    }
    if (!snapshot.postcode && typeof snapshot.lat === 'number' && typeof snapshot.lng === 'number') {
      const rg = await reverseGeocode(snapshot.lat, snapshot.lng);
      if (rg) {
        snapshot.postcode = rg.postcode;
        snapshot.outcode = rg.outcode;
        snapshot.locationConfidence = 'reverse-geocoded';
      }
    }
    await writeSnapshot(snapshot);
  }
  const { prefill, warnings } = snapshotToPrefill(snapshot);
  return { ok: true, detected, snapshot, prefill, warnings, fromCache: Boolean(cached) };
}

/** Upserts the member's own record of this listing (RLS-scoped session client). */
export async function recordCheckedListing(userId: string, snapshot: ListingSnapshot, quick: QuickEstimate | null): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const row = {
      user_id: userId,
      canonical_url: snapshot.canonicalUrl,
      source: snapshot.source,
      kind: snapshot.kind,
      postcode: snapshot.postcode ?? null,
      postcode_area: postcodeAreaOf(snapshot.outcode ?? snapshot.postcode) ?? null,
      lat: snapshot.lat ?? null,
      lng: snapshot.lng ?? null,
      snapshot,
      quick_estimate: quick,
      deal: quick?.deal ?? null,
      listing_status: snapshot.status ?? null,
      last_checked_at: snapshot.fetchedAt,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('checked_listings').upsert(row, { onConflict: 'user_id,canonical_url' }).select('id').single();
    if (error) {
      console.error('[listing] checked_listings upsert failed:', error.message);
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (err) {
    console.error('[listing] checked_listings upsert threw:', err);
    return null;
  }
}

/** How many listings this member has resolved today (for the daily cap). */
export async function resolvesToday(userId: string): Promise<number> {
  try {
    const supabase = await createSupabaseServerClient();
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase.from('checked_listings').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('updated_at', start.toISOString());
    return count ?? 0;
  } catch {
    return 0;
  }
}
