'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { areaMetaForCode } from '@/lib/market/areas';
import { mondayQuery } from '@/lib/apis/monday';
import { getMarketAccess } from '@/lib/market/gate';
import { isPipelineStatus } from '@/lib/listing/pipeline';
import { randomBytes } from 'node:crypto';
import { logActivity } from '@/lib/activity/log';

// The goals editor (saveMarketGoalsAction, clearMarketGoalsAction) left with
// Batch 12: every answer is made and changed on the profile page (/profile)
// and its quiz (/welcome), through src/lib/profile/server.ts.


/** Star / unstar an area. Returns the new saved state. */
export async function toggleSavedAreaAction(code: string): Promise<{ saved: boolean } | { error: string }> {
  const area = code.trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(area)) return { error: 'Unknown area' };
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Please sign in again.' };

  const { data: existing } = await supabase
    .from('saved_areas')
    .select('postcode_area')
    .eq('user_id', user.id)
    .eq('postcode_area', area)
    .maybeSingle();
  if (existing) {
    await supabase.from('saved_areas').delete().eq('user_id', user.id).eq('postcode_area', area);
    logActivity(user.id, 'area_removed');
    return { saved: false };
  }
  const { error } = await supabase.from('saved_areas').insert({ user_id: user.id, postcode_area: area });
  if (error) return { error: 'Could not save the area.' };
  logActivity(user.id, 'area_saved');
  return { saved: true };
}

export type EnquiryState = { error: string | null; sent: boolean };

const MANAGEMENT_LEADS_BOARD = process.env.MONDAY_MANAGEMENT_LEADS_BOARD_ID || '5891626711';
const MANAGEMENT_LEADS_EMAIL_COL = process.env.MONDAY_MANAGEMENT_LEADS_EMAIL_COL || 'text_mkygb5xx';

/**
 * "Talk to us about managing here": creates a lead on the Management Leads
 * board with the contact details and area, and posts the message as an
 * update on the item (so no further column ids need guessing). A hidden
 * `source` of 'my-deals' (the Secured stage's "Talk to us", Batch 7) labels
 * the lead as coming from a secured deal instead of the Market Explorer.
 */
export async function managementEnquiryAction(_prev: EnquiryState, formData: FormData): Promise<EnquiryState> {
  // Same gate as the explorer itself: members only.
  const { state, user } = await getMarketAccess();
  if (state !== 'ok' || !user) return { error: 'Please sign in again.', sent: false };

  const field = (k: string, max: number) => String(formData.get(k) ?? '').trim().slice(0, max);
  const name = field('name', 120);
  const posted = field('email', 200);
  // Prefer the verified account email; a different posted address is kept as a note.
  const email = user.email ?? posted;
  const phone = field('phone', 40);
  const area = field('area', 2).toUpperCase();
  const message = field('message', 2000);
  const fromMyDeals = field('source', 20) === 'my-deals';
  if (!name || !email.includes('@') || !/^[A-Z]{1,2}$/.test(area)) {
    return { error: 'Name, a valid email and an area are required.', sent: false };
  }
  const areaName = areaMetaForCode(area).name;

  const created = await mondayQuery<{ create_item: { id: string } | null }>(
    `mutation ($boardId: ID!, $name: String!, $values: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $values) { id }
    }`,
    {
      boardId: MANAGEMENT_LEADS_BOARD,
      name: `${fromMyDeals ? 'My deals enquiry' : 'Market Explorer enquiry'}: ${name} (${areaName})`,
      values: JSON.stringify({ [MANAGEMENT_LEADS_EMAIL_COL]: email }),
    },
  );
  const itemId = created?.create_item?.id;
  if (!itemId) return { error: 'We could not send your enquiry right now. Email hello@stayful.co.uk and we will pick it up.', sent: false };

  const body = [
    fromMyDeals ? `My deals: secured deal management enquiry` : `Market Explorer management enquiry`,
    `Area: ${areaName} (${area})`,
    `Name: ${name}`,
    `Email: ${email}`,
    posted && posted !== email ? `Contact email given: ${posted}` : null,
    phone ? `Phone: ${phone}` : null,
    message ? `Message: ${message}` : null,
  ].filter(Boolean).join('\n');
  await mondayQuery(`mutation ($itemId: ID!, $body: String!) { create_update(item_id: $itemId, body: $body) { id } }`, { itemId, body });

  // From My deals it is logged as a next step (src/lib/pipeline/events.ts), not twice.
  if (!fromMyDeals) logActivity(user.id, 'management_enquiry');
  return { error: null, sent: true };
}


// ─── Deal pipeline (checked listings) ────────────────────────────

const UUID = /^[0-9a-f-]{36}$/i;

async function ownListing(id: string) {
  if (!UUID.test(id)) return null;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, userId: user.id };
}

export async function updateListingStatusAction(id: string, status: string): Promise<{ ok: true } | { error: string }> {
  if (!isPipelineStatus(status)) return { error: 'Unknown status' };
  const ctx = await ownListing(id);
  if (!ctx) return { error: 'Please sign in again.' };
  const { error } = await ctx.supabase.from('checked_listings').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', ctx.userId);
  if (!error) logActivity(ctx.userId, 'stage_move', { extras: { to: status, via: 'explorer', item: `l-${id}` } });
  return error ? { error: 'Could not update the listing.' } : { ok: true };
}

export async function updateListingNotesAction(id: string, notes: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await ownListing(id);
  if (!ctx) return { error: 'Please sign in again.' };
  const clean = notes.slice(0, 2000);
  const { error } = await ctx.supabase.from('checked_listings').update({ notes: clean, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', ctx.userId);
  if (!error) logActivity(ctx.userId, 'listing_notes', { extras: { item: `l-${id}` } });
  return error ? { error: 'Could not save your notes.' } : { ok: true };
}

export async function removeCheckedListingAction(id: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await ownListing(id);
  if (!ctx) return { error: 'Please sign in again.' };
  const { error } = await ctx.supabase.from('checked_listings').delete().eq('id', id).eq('user_id', ctx.userId);
  if (!error) logActivity(ctx.userId, 'listing_removed', { extras: { item: `l-${id}` } });
  return error ? { error: 'Could not remove the listing.' } : { ok: true };
}

/** Mints (or returns) a share token for the public deal sheet. */
export async function shareListingAction(id: string): Promise<{ token: string } | { error: string }> {
  const ctx = await ownListing(id);
  if (!ctx) return { error: 'Please sign in again.' };
  const { data: existing } = await ctx.supabase.from('checked_listings').select('share_token').eq('id', id).eq('user_id', ctx.userId).maybeSingle();
  if (!existing) return { error: 'Listing not found.' };
  logActivity(ctx.userId, 'listing_share', { extras: { on: true, item: `l-${id}` } });
  if (typeof existing.share_token === 'string' && existing.share_token) return { token: existing.share_token };
  const token = randomBytes(24).toString('base64url');
  const { error } = await ctx.supabase.from('checked_listings').update({ share_token: token, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', ctx.userId);
  return error ? { error: 'Could not create a share link.' } : { token };
}

export async function unshareListingAction(id: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await ownListing(id);
  if (!ctx) return { error: 'Please sign in again.' };
  const { error } = await ctx.supabase.from('checked_listings').update({ share_token: null, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', ctx.userId);
  if (!error) logActivity(ctx.userId, 'listing_share', { extras: { on: false, item: `l-${id}` } });
  return error ? { error: 'Could not revoke the share link.' } : { ok: true };
}
