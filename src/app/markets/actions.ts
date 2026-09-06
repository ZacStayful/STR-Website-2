'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { geocodePostcode } from '@/lib/apis/geocode';
import { goalsFromForm, parseMarketGoals } from '@/lib/market/goals';
import { areaMetaForCode } from '@/lib/market/areas';
import { mondayQuery } from '@/lib/apis/monday';
import { getMarketAccess } from '@/lib/market/gate';

export type GoalsState = { error: string | null; warning: string | null; saved: boolean };

/**
 * Save the goal profile. Geocodes the home postcode (once per change) so the
 * distance ranking needs no API calls at read time. A geocoding failure is a
 * warning, not an error — the profile still saves, without coordinates.
 */
export async function saveMarketGoalsAction(_prev: GoalsState, formData: FormData): Promise<GoalsState> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Please sign in again.', warning: null, saved: false };

  const goals = goalsFromForm((k) => {
    const v = formData.get(k);
    return typeof v === 'string' ? v : null;
  });

  let warning: string | null = null;
  if (goals.home) {
    const { data: row } = await supabase.from('profiles').select('market_goals').eq('id', user.id).single();
    const previous = parseMarketGoals(row?.market_goals);
    if (previous?.home && previous.home.postcode === goals.home.postcode && previous.home.lat !== null) {
      goals.home = previous.home; // unchanged postcode: keep the cached coordinates
    } else {
      try {
        const { lat, lng } = await geocodePostcode(goals.home.postcode);
        goals.home = { ...goals.home, lat, lng };
      } catch (err) {
        console.warn('[markets/goals] geocode failed:', (err as Error)?.message ?? err);
        warning = `We couldn't place ${goals.home.postcode} on the map, so distance ranking is off until you try again.`;
      }
    }
  }

  const alertWeekly = formData.get('alertWeekly') === '1';
  const { error } = await supabase
    .from('profiles')
    .update({ market_goals: goals, market_goals_updated_at: new Date().toISOString(), alert_weekly: alertWeekly })
    .eq('id', user.id);
  if (error) return { error: 'Could not save your goals. Please try again.', warning: null, saved: false };

  revalidatePath('/markets');
  return { error: null, warning, saved: true };
}

export async function clearMarketGoalsAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('profiles').update({ market_goals: null, market_goals_updated_at: new Date().toISOString() }).eq('id', user.id);
  revalidatePath('/markets');
}

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
    return { saved: false };
  }
  const { error } = await supabase.from('saved_areas').insert({ user_id: user.id, postcode_area: area });
  if (error) return { error: 'Could not save the area.' };
  return { saved: true };
}

export type EnquiryState = { error: string | null; sent: boolean };

const MANAGEMENT_LEADS_BOARD = process.env.MONDAY_MANAGEMENT_LEADS_BOARD_ID || '5891626711';
const MANAGEMENT_LEADS_EMAIL_COL = process.env.MONDAY_MANAGEMENT_LEADS_EMAIL_COL || 'text_mkygb5xx';

/**
 * "Talk to us about managing here": creates a lead on the Management Leads
 * board with the contact details and area, and posts the message as an
 * update on the item (so no further column ids need guessing).
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
      name: `Market Explorer enquiry: ${name} (${areaName})`,
      values: JSON.stringify({ [MANAGEMENT_LEADS_EMAIL_COL]: email }),
    },
  );
  const itemId = created?.create_item?.id;
  if (!itemId) return { error: 'We could not send your enquiry right now. Email hello@stayful.co.uk and we will pick it up.', sent: false };

  const body = [
    `Market Explorer management enquiry`,
    `Area: ${areaName} (${area})`,
    `Name: ${name}`,
    `Email: ${email}`,
    posted && posted !== email ? `Contact email given: ${posted}` : null,
    phone ? `Phone: ${phone}` : null,
    message ? `Message: ${message}` : null,
  ].filter(Boolean).join('\n');
  await mondayQuery(`mutation ($itemId: ID!, $body: String!) { create_update(item_id: $itemId, body: $body) { id } }`, { itemId, body });

  return { error: null, sent: true };
}
