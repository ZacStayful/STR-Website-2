import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { grant } from './ledger';
import { getBillingSettings } from './unit-costs';
import { isDisposableEmail, normaliseMobile } from './abuse';

/**
 * Grants the one-off welcome credit to a member the first time we see them
 * signed in, after the abuse checks: not a disposable email domain, and a
 * mobile number no other account has already used. Idempotent (source_ref)
 * and cheap after the first call (welcome_checked_at short-circuits).
 */
export async function ensureWelcomeGrant(userId: string, email: string | null): Promise<{ granted: boolean; withheld: string | null }> {
  if (!hasServiceRole()) return { granted: false, withheld: null };
  const admin = createAdminClient();
  const { data: profile } = await admin.from('profiles').select('id, mobile, mobile_key, welcome_checked_at, welcome_withheld_reason').eq('id', userId).maybeSingle();
  if (!profile) return { granted: false, withheld: null };
  if (profile.welcome_checked_at) return { granted: false, withheld: (profile.welcome_withheld_reason as string | null) ?? null };

  let withheld: string | null = null;
  if (isDisposableEmail(email)) withheld = 'disposable_email';

  const mobileKey = normaliseMobile(profile.mobile as string | null);
  if (!withheld && mobileKey) {
    const { data: clash } = await admin.from('profiles').select('id').eq('mobile_key', mobileKey).neq('id', userId).limit(1);
    if ((clash?.length ?? 0) > 0) withheld = 'mobile_already_used';
  }

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
  const settings = await getBillingSettings();
  await grant(userId, 'welcome', settings.welcomeGrantPence, { sourceRef: `welcome:${userId}`, description: 'Welcome credit' });
  return { granted: true, withheld: null };
}

export const WELCOME_WITHHELD_COPY: Record<string, string> = {
  disposable_email: 'Welcome credit is not available for temporary email addresses. You can still top up or subscribe.',
  mobile_already_used: 'This mobile number has already received welcome credit on another account. You can still top up or subscribe.',
};
