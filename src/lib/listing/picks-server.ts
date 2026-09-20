import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { areaMetaForCode } from '../market/areas';
import { isPickToken, cleanReasons, dealScoreOf, type PickBasis, type PickReaction, type PickReason, type PickStatus, type ReactionSource } from './picks';
import type { SourcedListing } from './sourcing';
import type { Deal } from './deal';
import type { ResponseRow } from './picks-patterns';

/**
 * Service-role reads and writes for daily picks. `sourcing_sent` and
 * `sourced_listings` have RLS on with no member policies, so every caller
 * here has already checked the session (or holds a valid pick token) and
 * every write is scoped by user id or token.
 */

export interface PickView {
  id: string;
  userId: string;
  token: string | null;
  status: PickStatus;
  kind: 'sale' | 'rent';
  basis: PickBasis;
  postcodeArea: string | null;
  areaName: string | null;
  listing: SourcedListing;
  deal: Deal | null;
  fit: number | null;
  chargedBasePence: number;
  reaction: PickReaction | null;
  reactionSource: ReactionSource | null;
  reasons: PickReason[];
  comment: string;
  respondedAt: string | null;
  checkedListingId: string | null;
  savedAt: string | null;
  sentAt: string;
}

const PICK_COLUMNS = 'id, user_id, canonical_url, token, status, kind, basis, postcode_area, deal, fit, charged_base_pence, reaction, reaction_source, reasons, comment, responded_at, checked_listing_id, saved_at, sent_at';

function toView(raw: Record<string, unknown>, listing: SourcedListing | null): PickView | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const userId = typeof raw.user_id === 'string' ? raw.user_id : null;
  const url = typeof raw.canonical_url === 'string' ? raw.canonical_url : null;
  if (!id || !userId || !url) return null;
  const kind = raw.kind === 'rent' ? 'rent' : 'sale';
  const status: PickStatus = raw.status === 'pending' || raw.status === 'failed' ? raw.status : 'sent';
  const area = typeof raw.postcode_area === 'string' ? raw.postcode_area : null;
  const fallback: SourcedListing = { source: 'onthemarket', id: url, canonicalUrl: url, kind, title: url, address: null, postcode: null, outcode: null, postcodeArea: area, lat: null, lng: null, bedrooms: null, bathrooms: null, price: null, rawType: null, photo: null };
  return {
    id,
    userId,
    token: typeof raw.token === 'string' ? raw.token : null,
    status,
    kind,
    basis: raw.basis === 'house' ? 'house' : 'goals',
    postcodeArea: area,
    areaName: area ? areaMetaForCode(area).name : null,
    listing: listing ?? fallback,
    deal: (raw.deal as Deal | null) ?? null,
    fit: typeof raw.fit === 'number' ? raw.fit : null,
    chargedBasePence: Number(raw.charged_base_pence) || 0,
    reaction: raw.reaction === 'yes' || raw.reaction === 'no' ? raw.reaction : null,
    reactionSource: raw.reaction_source === 'form' || raw.reaction_source === 'link' ? raw.reaction_source : null,
    reasons: cleanReasons(raw.reasons),
    comment: typeof raw.comment === 'string' ? raw.comment : '',
    respondedAt: typeof raw.responded_at === 'string' ? raw.responded_at : null,
    checkedListingId: typeof raw.checked_listing_id === 'string' ? raw.checked_listing_id : null,
    savedAt: typeof raw.saved_at === 'string' ? raw.saved_at : null,
    sentAt: typeof raw.sent_at === 'string' ? raw.sent_at : new Date(0).toISOString(),
  };
}

async function listingsFor(urls: string[]): Promise<Map<string, SourcedListing>> {
  const out = new Map<string, SourcedListing>();
  if (urls.length === 0) return out;
  const admin = createAdminClient();
  for (let i = 0; i < urls.length; i += 150) {
    const { data } = await admin.from('sourced_listings').select('canonical_url, snapshot').in('canonical_url', urls.slice(i, i + 150));
    for (const r of (data ?? []) as { canonical_url: string; snapshot: SourcedListing }[]) out.set(r.canonical_url, r.snapshot);
  }
  return out;
}

/** One pick by its public token (the email buttons). Null for a bad or unknown token. */
export async function pickByToken(token: string): Promise<PickView | null> {
  if (!isPickToken(token) || !hasServiceRole()) return null;
  const { data } = await createAdminClient().from('sourcing_sent').select(PICK_COLUMNS).eq('token', token).maybeSingle();
  if (!data) return null;
  const raw = data as Record<string, unknown>;
  const listings = await listingsFor([String(raw.canonical_url)]);
  return toView(raw, listings.get(String(raw.canonical_url)) ?? null);
}

/** One pick by id, for its owner only. */
export async function pickForMember(id: string, userId: string): Promise<PickView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !hasServiceRole()) return null;
  const { data } = await createAdminClient().from('sourcing_sent').select(PICK_COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle();
  if (!data) return null;
  const raw = data as Record<string, unknown>;
  const listings = await listingsFor([String(raw.canonical_url)]);
  return toView(raw, listings.get(String(raw.canonical_url)) ?? null);
}

/** Every pick sent to a member, newest first. Pending and failed rows are not shown. */
export async function loadPicks(userId: string, limit = 120): Promise<PickView[]> {
  if (!hasServiceRole()) return [];
  const { data, error } = await createAdminClient().from('sourcing_sent').select(PICK_COLUMNS).eq('user_id', userId).eq('status', 'sent').order('sent_at', { ascending: false }).limit(limit);
  if (error) {
    console.warn('[picks] sourcing_sent select failed (schema behind?):', error.message);
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const listings = await listingsFor([...new Set(rows.map((r) => String(r.canonical_url)))]);
  return rows.map((r) => toView(r, listings.get(String(r.canonical_url)) ?? null)).filter((v): v is PickView => v !== null);
}

/**
 * Every answered pick (admin store), newest answer first, with the member's
 * email and the listing behind it. Older rows carry no tenure; that reads
 * as unknown.
 */
export async function loadResponses(opts: { since: string | null; limit?: number }): Promise<ResponseRow[]> {
  if (!hasServiceRole()) return [];
  const admin = createAdminClient();
  let q = admin.from('sourcing_sent').select(PICK_COLUMNS).not('reaction', 'is', null).eq('status', 'sent');
  if (opts.since) q = q.gte('sent_at', opts.since);
  const { data, error } = await q.order('responded_at', { ascending: false, nullsFirst: false }).limit(opts.limit ?? 5000);
  if (error) {
    console.warn('[picks] responses select failed (schema behind?):', error.message);
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const userIds = [...new Set(rows.map((r) => String(r.user_id)))];
  const emails = new Map<string, string | null>();
  for (let i = 0; i < userIds.length; i += 100) {
    const { data: profiles } = await admin.from('profiles').select('id, email').in('id', userIds.slice(i, i + 100));
    for (const p of (profiles ?? []) as { id: string; email: string | null }[]) emails.set(p.id, p.email);
  }
  const listings = await listingsFor([...new Set(rows.map((r) => String(r.canonical_url)))]);
  const out: ResponseRow[] = [];
  for (const raw of rows) {
    const v = toView(raw, listings.get(String(raw.canonical_url)) ?? null);
    if (!v || !v.reaction || !v.reactionSource) continue;
    const l = v.listing;
    const amount = l.price ? (l.kind === 'rent' ? (l.price.period === 'pw' ? Math.round((l.price.amount * 52) / 12) : l.price.amount) : l.price.period === 'total' ? l.price.amount : null) : null;
    out.push({
      id: v.id,
      userId: v.userId,
      email: emails.get(v.userId) ?? null,
      sentAt: v.sentAt,
      respondedAt: v.respondedAt,
      reaction: v.reaction,
      reactionSource: v.reactionSource,
      reasons: v.reasons,
      comment: v.comment,
      kind: v.kind,
      basis: v.basis,
      postcodeArea: v.postcodeArea,
      areaName: v.areaName,
      title: l.title,
      address: l.address,
      url: l.canonicalUrl,
      bedrooms: l.bedrooms,
      rawType: l.rawType,
      tenure: l.tenure ?? null,
      amount,
      fit: v.fit,
      dealScore: dealScoreOf(v.deal),
      savedAt: v.savedAt,
    });
  }
  return out;
}

export interface ReactionInput {
  reaction: PickReaction;
  source: ReactionSource;
  reasons?: unknown;
  comment?: unknown;
}

/**
 * Records what the member thought of a pick. A link click (email button)
 * only sets the reaction; the form sets reasons and comment too and marks
 * the response as confirmed, which is what the cron's feedback rules read.
 */
export async function recordReaction(where: { token: string } | { id: string; userId: string }, input: ReactionInput): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const patch: Record<string, unknown> = { reaction: input.reaction, reaction_source: input.source, responded_at: new Date().toISOString() };
  if (input.source === 'form') {
    patch.reasons = input.reaction === 'no' ? cleanReasons(input.reasons) : [];
    patch.comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, 1000) || null : null;
  }
  let q = createAdminClient().from('sourcing_sent').update(patch);
  q = 'token' in where ? q.eq('token', where.token) : q.eq('id', where.id).eq('user_id', where.userId);
  const { error } = await q;
  if (error) console.error('[picks] reaction update failed:', error.message);
  return !error;
}

/** Turns daily picks on or off for a member; off remembers when, so a schema backfill never re-enrols them. */
export async function setPicksEnabled(userId: string, on: boolean): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { error } = await createAdminClient().from('profiles').update({ sourcing_alerts: on, sourcing_opted_out_at: on ? null : new Date().toISOString() }).eq('id', userId);
  if (error) console.error('[picks] profile update failed:', error.message);
  return !error;
}

/** Links a pick to the pipeline row the member saved it as. */
export async function markPickSaved(id: string, userId: string, checkedListingId: string): Promise<void> {
  if (!hasServiceRole()) return;
  const { error } = await createAdminClient().from('sourcing_sent').update({ checked_listing_id: checkedListingId, saved_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId);
  if (error) console.error('[picks] saved update failed:', error.message);
}

/** Whether a member has picks on (null when the profile cannot be read). */
export async function picksEnabled(userId: string): Promise<boolean | null> {
  if (!hasServiceRole()) return null;
  const { data } = await createAdminClient().from('profiles').select('sourcing_alerts').eq('id', userId).maybeSingle();
  return data ? data.sourcing_alerts !== false : null;
}
