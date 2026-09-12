import 'server-only';

import { randomBytes } from 'node:crypto';
import { createAdminClient } from '../supabase/admin';
import { getBillingSettings } from './unit-costs';
import { siteUrl } from '../url';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len = 8): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * Each member gets one referral code (a `credit_codes` row they own). The
 * redeemer and the owner both receive `referral_pence` when it is used.
 */
export async function ensureReferralCode(userId: string): Promise<{ code: string; url: string; rewardPence: number; earnedPence: number; redemptions: number }> {
  const admin = createAdminClient();
  const settings = await getBillingSettings();
  const { data: profile } = await admin.from('profiles').select('referral_code').eq('id', userId).maybeSingle();
  let code = (profile?.referral_code as string | null) ?? null;
  if (!code) {
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      const candidate = randomCode();
      const { error } = await admin.from('credit_codes').insert({ code: candidate, kind: 'referral', amount_pence: settings.referralPence, owner_user_id: userId, created_by: 'referral' });
      if (error) continue;
      const { error: pErr } = await admin.from('profiles').update({ referral_code: candidate }).eq('id', userId);
      if (pErr) continue;
      code = candidate;
    }
    if (!code) throw new Error('could not allocate a referral code');
  }
  const { data: row } = await admin.from('credit_codes').select('redeemed_count').eq('code', code).maybeSingle();
  const redemptions = Number(row?.redeemed_count ?? 0) || 0;
  return { code, url: siteUrl(`/signup?ref=${code}`), rewardPence: settings.referralPence, earnedPence: redemptions * settings.referralPence, redemptions };
}
