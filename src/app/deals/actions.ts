'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { openDeal, saveOpenedDealToPipeline } from '@/lib/marketplace/open';
import { dealVisibilityFor } from '@/lib/marketplace/tier';
import { isDealReaction, type DealReaction } from '@/lib/marketplace/reactions';
import { setDealReaction, setPassReasons } from '@/lib/marketplace/reactions-server';
import { createDealShare } from '@/lib/marketplace/share';
import { ensureReferralCode } from '@/lib/credit/referral';
import { siteUrl } from '@/lib/url';
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

export type ShareActionResult = { ok: true; url: string } | { ok: false; error: 'signed_out' | 'missing' | 'failed' };

/**
 * The member's public link to a deal (/d/<token>): what the card shows and
 * nothing more, with a join button carrying their referral code so both
 * sides get the referral credit. Free.
 */
export async function shareDealAction(dealId: unknown): Promise<ShareActionResult> {
  if (typeof dealId !== 'string' || !UUID.test(dealId)) return { ok: false, error: 'missing' };
  const me = await signedIn();
  if (!me) return { ok: false, error: 'signed_out' };
  const visibility = await dealVisibilityFor(me.user.id, me.adminUser);
  const share = await createDealShare(me.user.id, dealId, visibility);
  if (!share.ok) return { ok: false, error: share.code };
  // The join button reads the sharer's code; make sure they have one. A
  // failure here must never cost them the link: the button falls back to a
  // plain sign-up.
  try {
    await ensureReferralCode(me.user.id);
  } catch (err) {
    console.warn('[deal-share] referral code failed:', (err as Error)?.message ?? err);
  }
  return { ok: true, url: siteUrl(`/d/${share.token}`) };
}
