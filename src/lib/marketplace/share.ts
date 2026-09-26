import 'server-only';

/**
 * Share links for marketplace deals (/d/<token>). The checked-listing share
 * (src/lib/listing/share.ts) keeps its token on the member's own
 * checked_listings row; a marketplace deal is one row everyone shares, so its
 * links live in deal_shares instead — same token shape, one per (sharer,
 * deal), read back with the service role because the page has no session.
 *
 * The public read selects CARD_COLUMNS and nothing else: never canonical_url,
 * address, postcode, photo URLs or the sharer's id. It never goes near
 * dealSheet(), so what the sharer paid to open cannot reach it.
 */
import { randomBytes } from 'node:crypto';
import { cache } from 'react';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { CARD_COLUMNS, type DealCard } from './grid';
import { isShareToken } from './share-view';
import { dealVisible, type DealVisibility } from './visibility';

/**
 * The member's link to a deal they can see (an account inside the
 * early-access window cannot share a deal it has not been shown). Sharing is
 * free. A deal that has since gone can still be shared: the page says so.
 */
export async function createDealShare(userId: string, dealId: string, visibility: DealVisibility): Promise<{ ok: true; token: string } | { ok: false; code: 'missing' | 'failed' }> {
  if (!hasServiceRole()) return { ok: false, code: 'failed' };
  const { data: deal, error } = await createAdminClient().from('marketplace_deals').select('id, live_since').eq('id', dealId).maybeSingle();
  if (error) {
    console.error('[deal-share] deal read failed:', error.message);
    return { ok: false, code: 'failed' };
  }
  if (!deal || !dealVisible(deal.live_since as string | null, visibility.cutoffIso)) return { ok: false, code: 'missing' };
  const token = await ensureDealShare(userId, dealId);
  return token ? { ok: true, token } : { ok: false, code: 'failed' };
}

/**
 * The member's link to this deal, minted on first share. Upserted without
 * overwriting, then read back, so two taps at once still end with one link.
 */
async function ensureDealShare(userId: string, dealId: string): Promise<string | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  const read = async () => {
    const { data, error } = await admin.from('deal_shares').select('token').eq('user_id', userId).eq('deal_id', dealId).maybeSingle();
    if (error) console.error('[deal-share] read failed:', error.message);
    return typeof data?.token === 'string' ? data.token : null;
  };
  const existing = await read();
  if (existing) return existing;
  const { error } = await admin.from('deal_shares').upsert({ token: randomBytes(24).toString('base64url'), user_id: userId, deal_id: dealId }, { onConflict: 'user_id,deal_id', ignoreDuplicates: true });
  if (error) {
    console.error('[deal-share] insert failed:', error.message);
    return null;
  }
  return read();
}

export interface SharedDeal {
  /** Card columns only (plus has_photo). */
  card: DealCard;
  /** The sharer's referral code for the join button; never their id. Null when they have none. */
  referralCode: string | null;
}

/**
 * One shared deal by its token, for the public page and its metadata (cached
 * per request so both read the same row). Null for a bad or unknown token.
 */
export const sharedDealByToken = cache(async (token: string): Promise<SharedDeal | null> => {
  if (!isShareToken(token) || !hasServiceRole()) return null;
  const admin = createAdminClient();
  const { data: share } = await admin.from('deal_shares').select('deal_id, user_id').eq('token', token).maybeSingle();
  if (!share) return null;
  const [dealRes, profileRes] = await Promise.all([
    admin.from('marketplace_deals').select(`${CARD_COLUMNS}, photo`).eq('id', share.deal_id).maybeSingle(),
    admin.from('profiles').select('referral_code').eq('id', share.user_id).maybeSingle(),
  ]);
  if (dealRes.error) console.error('[deal-share] deal read failed:', dealRes.error.message);
  if (!dealRes.data) return null;
  const { photo, ...card } = dealRes.data as unknown as DealCard & { photo: string | null };
  const code = profileRes.data?.referral_code;
  return { card: { ...card, has_photo: Boolean(photo) }, referralCode: typeof code === 'string' ? code : null };
});
