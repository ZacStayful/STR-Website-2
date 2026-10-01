import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { grant, redeemCode, CodeError } from './ledger';
import { getBillingSettings } from './unit-costs';
import { isDisposableEmail, normaliseMobile } from './abuse';
import { teamOf, hasOpenInvite } from '../team';
import { isPackAccount, welcomeGrantRef } from '../lifecycle/settings';
import { readStarterPackCutover } from '../lifecycle/settings-server';
import { welcomeOutcome, withheldReason } from './welcome-rules';

/**
 * Grants the one-off welcome credit to a member the first time we see them
 * signed in, after the abuse checks: not a disposable email domain, and a
 * mobile number no other account has already used. Idempotent (source_ref)
 * and cheap after the first call (welcome_checked_at short-circuits).
 *
 * Batch 20: an account created at or after the starter pack's cutover
 * (billing_settings.starter_pack_from) gets the pack offer instead, so no
 * welcome credit. The checks still run and are stamped exactly as before,
 * because the £5 profile credit, the first-week £1s and the daily picks all
 * follow them, and its number is still claimed; a referral code is still
 * redeemed. Accounts created before the cutover are untouched.
 */
export async function ensureWelcomeGrant(userId: string, email: string | null): Promise<{ granted: boolean; withheld: string | null }> {
  if (!hasServiceRole()) return { granted: false, withheld: null };
  const admin = createAdminClient();
  const { data: profile } = await admin.from('profiles').select('id, created_at, mobile, mobile_key, welcome_checked_at, welcome_withheld_reason').eq('id', userId).maybeSingle();
  if (!profile) return { granted: false, withheld: null };
  if (profile.welcome_checked_at) return { granted: false, withheld: (profile.welcome_withheld_reason as string | null) ?? null };

  // A team member spends the team's credit, not their own. Someone with an
  // invite still open is decided later, not now: if they never join, they
  // should still get the welcome credit anyone else would.
  if ((await teamOf(userId)).role === 'member') {
    await admin.from('profiles').update({ welcome_checked_at: new Date().toISOString(), welcome_withheld_reason: 'team_member' }).eq('id', userId);
    return { granted: false, withheld: 'team_member' };
  }
  if (await hasOpenInvite(email)) return { granted: false, withheld: null };

  // Batch 21 (G3): the facts, then the one decision (src/lib/credit/welcome-rules.ts, tested).
  const mobileKey = normaliseMobile(profile.mobile as string | null);
  let mobileAlreadyUsed = false;
  if (mobileKey) {
    const { data: clash } = await admin.from('profiles').select('id').eq('mobile_key', mobileKey).neq('id', userId).limit(1);
    mobileAlreadyUsed = (clash?.length ?? 0) > 0;
  }
  // Batch 20: the starter pack replaces the welcome credit for new members.
  // Read directly, never from a default: when the setting cannot be read
  // nothing is stamped and the next sign-in decides, so a bad read can never
  // grant £20 to a member the pack was meant for.
  const cutover = await readStarterPackCutover();
  // Batch 21 (B45): a pack bought or being paid for (the cutover moved later
  // while a Checkout was in flight) is never topped with the £20 as well.
  const { data: packRows } = await admin.from('starter_pack_purchases').select('payment_intent_id').eq('user_id', userId).in('status', ['reserved', 'granted']).limit(1);
  const outcome = welcomeOutcome({
    teamMember: false,
    openInvite: false,
    disposableEmail: isDisposableEmail(email),
    mobileAlreadyUsed,
    cutoverKnown: cutover.ok,
    packAccount: cutover.ok ? isPackAccount(profile.created_at as string | null, { starterPackFrom: cutover.from }) : false,
    hasPack: (packRows?.length ?? 0) > 0,
  });
  if (outcome === 'postpone') {
    console.warn(`[credit] welcome decision for ${userId} postponed: the starter pack setting could not be read`);
    return { granted: false, withheld: null };
  }

  let withheld: string | null = withheldReason(outcome);
  const update: Record<string, unknown> = { welcome_checked_at: new Date().toISOString(), welcome_withheld_reason: withheld };
  if (mobileKey && !withheld) {
    // Claim the number; a race with another signup loses on the unique index.
    const { error } = await admin.from('profiles').update({ ...update, mobile_key: mobileKey }).eq('id', userId);
    if (error) {
      withheld = 'mobile_already_used';
      await admin.from('profiles').update({ ...update, welcome_withheld_reason: withheld }).eq('id', userId);
    }
  } else {
    await admin.from('profiles').update(update).eq('id', userId);
  }

  if (withheld) {
    console.warn(`[credit] welcome credit withheld for ${userId}: ${withheld}`);
    return { granted: false, withheld };
  }
  if (outcome === 'pack') {
    await redeemPendingReferral(userId);
    return { granted: false, withheld: null };
  }
  try {
    const settings = await getBillingSettings();
    await grant(userId, 'welcome', settings.welcomeGrantPence, { sourceRef: welcomeGrantRef(userId), description: 'Welcome credit' });
  } catch (err) {
    // The check stamp went in before the grant so a concurrent call would not
    // grant twice. If the grant itself failed, clear it again: otherwise the
    // early return above leaves this member permanently without their credit.
    // The grant is idempotent on source_ref, so a retry can never double-grant.
    await admin.from('profiles').update({ welcome_checked_at: null }).eq('id', userId);
    console.error(`[credit] welcome grant failed for ${userId}; will retry on next sign-in:`, (err as Error)?.message ?? err);
    return { granted: false, withheld: null };
  }
  await redeemPendingReferral(userId);
  return { granted: true, withheld: null };
}

/** Redeems the referral code remembered at signup (sf_ref cookie), if any. */
async function redeemPendingReferral(userId: string): Promise<void> {
  try {
    const { cookies } = await import('next/headers');
    const jar = await cookies();
    const code = jar.get('sf_ref')?.value;
    if (!code) return;
    await redeemCode(userId, code);
    try {
      jar.delete('sf_ref');
    } catch {
      /* read-only cookie store in a server component: the code is single-use anyway */
    }
  } catch (err) {
    if (!(err instanceof CodeError)) console.warn('[credit] referral redemption failed:', (err as Error).message);
  }
}

export const WELCOME_WITHHELD_COPY: Record<string, string> = {
  disposable_email: 'Welcome credit is not available for temporary email addresses. You can still top up or subscribe.',
  mobile_already_used: 'This mobile number has already received welcome credit on another account. You can still top up or subscribe.',
  team_member: 'You use your team’s credit, so there is no separate welcome credit on this login.',
};
