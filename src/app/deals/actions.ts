'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { openDeal, saveOpenedDealToPipeline } from '@/lib/marketplace/open';
import { dealVisibilityFor } from '@/lib/marketplace/tier';
import { isDealReaction, type DealReaction } from '@/lib/marketplace/reactions';
import { setDealReaction, setPassReasons } from '@/lib/marketplace/reactions-server';
import { payerFor } from '@/lib/team';

const UUID = /^[0-9a-f-]{36}$/i;

async function member() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/deals');
  return { supabase, user, adminUser: isAdminEmail(user.email) };
}

/**
 * Open a deal sheet: verify the listing is still on the market, charge the
 * ladder price, unlock. Never from a bare link — the member presses the
 * button on the deal page.
 */
export async function openDealAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) redirect('/deals?msg=missing');
  const { user, adminUser } = await member();
  // A team member opens deals for the team, on the owner's credit.
  const payer = await payerFor(user.id);
  if (payer.suspended) redirect(`/deals/${encodeURIComponent(id)}?msg=insufficient_credit`);
  let outcome;
  try {
    const visibility = await dealVisibilityFor(user.id, adminUser);
    outcome = await openDeal({ userId: payer.payerId, adminUser, dealId: id, memberId: payer.memberId, visibility });
  } catch (err) {
    console.error('[deals] open failed:', err);
    redirect(`/deals/${encodeURIComponent(id)}?msg=failed`);
  }
  if (!outcome.ok) {
    if (outcome.code === 'missing') redirect('/deals?msg=missing');
    const extra = outcome.code === 'insufficient_credit' ? `&need=${outcome.requiredPence ?? 0}&have=${outcome.availablePence ?? 0}` : '';
    redirect(`/deals/${encodeURIComponent(id)}?msg=${outcome.code}${extra}`);
  }
  redirect(`/deals/${encodeURIComponent(id)}${outcome.alreadyOpen ? '' : '?msg=opened'}`);
}

export async function savePipelineAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) redirect('/deals?msg=missing');
  const { user, adminUser } = await member();
  const payer = await payerFor(user.id);
  const result = await saveOpenedDealToPipeline(user.id, id, adminUser, payer.payerId);
  if (!result.ok) redirect(`/deals/${encodeURIComponent(id)}?msg=${result.code === 'missing' ? 'missing' : result.code === 'not_open' ? 'not_open' : 'save_failed'}`);
  redirect(`/markets?pane=listings&listing=${encodeURIComponent(result.checkedListingId)}`);
}

// ── Keep, Pass (and Share, below): called from the card's buttons ──
// These run from a client component, so they answer rather than redirect,
// and they never revalidate: a re-render would take the reason picker away
// from under the member. None of them touches credit.

export type ReactionActionResult = { ok: true; reaction: DealReaction | null } | { ok: false; error: 'signed_out' | 'missing' | 'gone' | 'failed' };

/** The signed-in member, or null. For actions a client calls: no redirect. */
async function signedIn() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { user, adminUser: isAdminEmail(user.email) } : null;
}

/**
 * Sets the member's reaction to a deal to exactly `target` (null clears it).
 * The card works out the target from what it shows, so a replayed request
 * lands in the same state instead of flipping it back.
 */
export async function setDealReactionAction(dealId: unknown, target: unknown): Promise<ReactionActionResult> {
  if (typeof dealId !== 'string' || !UUID.test(dealId)) return { ok: false, error: 'missing' };
  if (target !== null && !isDealReaction(target)) return { ok: false, error: 'failed' };
  const me = await signedIn();
  if (!me) return { ok: false, error: 'signed_out' };
  // An account inside the early-access window cannot react to a deal it cannot see.
  const visibility = await dealVisibilityFor(me.user.id, me.adminUser);
  const outcome = await setDealReaction(me.user.id, dealId, target, visibility);
  return outcome.ok ? { ok: true, reaction: outcome.reaction } : { ok: false, error: outcome.code };
}

/** Why the member passed. Optional; only ever lands on a deal that is still a pass. */
export async function savePassReasonsAction(dealId: unknown, reasons: unknown): Promise<{ ok: boolean }> {
  if (typeof dealId !== 'string' || !UUID.test(dealId) || !Array.isArray(reasons)) return { ok: false };
  const me = await signedIn();
  if (!me) return { ok: false };
  return { ok: await setPassReasons(me.user.id, dealId, reasons.slice(0, 20)) };
}
