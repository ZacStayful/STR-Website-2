import 'server-only';

import { cache } from 'react';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { emailKey } from '../supabase/email-key';
import { getBillingSettings } from '../credit/unit-costs';
import { normaliseMobile } from '../credit/abuse';
import { teamOf } from '../team';
import { ACCESS_COLUMNS, accountStatus, type AccessProfile } from '../access';
import { isPackAccount } from '../lifecycle/settings';
import { todayKey } from '../today/day';
import { logActivity } from '../activity/log';
import { packCopy, packOffer, snoozeUntil, todayCardShown, type PackCopy, type PackOffer } from './rules';

/**
 * Who is offered the starter pack, read for one member (Batch 20, Part A).
 * The rules are in ./rules.ts. Every read that could fail (the Batch 20
 * columns before the schema is run, a claim lookup) makes the offer "off"
 * rather than guess: nobody is offered a pack the site cannot sell them.
 */

export interface PackState {
  offer: PackOffer;
  /** The Today card: eligible and not inside a "Not now". */
  showTodayCard: boolean;
  snoozedUntil: string | null;
  copy: PackCopy;
  pricePence: number;
  creditPence: number;
}

type ProfileRow = { created_at: string | null; email: string | null; mobile: string | null } & AccessProfile;

async function claimed(column: 'user_id' | 'email_key' | 'mobile_key', value: string | null): Promise<boolean | null> {
  if (!value) return false;
  const { data, error } = await createAdminClient().from('starter_pack_purchases').select('payment_intent_id').eq(column, value).in('status', ['reserved', 'granted']).limit(1);
  if (error) return null;
  return (data?.length ?? 0) > 0;
}

async function load(userId: string): Promise<PackState> {
  const settings = await getBillingSettings();
  const lc = settings.lifecycle;
  const copy = packCopy(lc, settings.dealPricing.fullAnalysisPence, settings.spendRates);
  const off = (reason: 'off' | 'existing_member' | 'team_member' | 'bought' | 'already_had' | 'on_plan'): PackState => ({
    offer: { eligible: false, reason },
    showTodayCard: false,
    snoozedUntil: null,
    copy,
    pricePence: lc.starterPackPricePence,
    creditPence: lc.starterPackCreditPence,
  });
  if (!lc.starterPackFrom || !hasServiceRole()) return off('off');
  const admin = createAdminClient();
  const { data, error } = await admin.from('profiles').select(`created_at, email, mobile, ${ACCESS_COLUMNS}`).eq('id', userId).maybeSingle();
  const p = (data as ProfileRow | null) ?? null;
  if (error || !p) return off('off');
  // Existing members never see it: stop before any other read.
  if (!isPackAccount(p.created_at, lc)) return off('existing_member');

  // The Batch 20 columns in a query of their own: before the schema is run it fails, and the pack is simply off.
  const [cols, team, byAccount, byEmail, byMobile] = await Promise.all([
    admin.from('profiles').select('starter_pack_bought_at, starter_pack_snoozed_until').eq('id', userId).maybeSingle(),
    teamOf(userId),
    claimed('user_id', userId),
    claimed('email_key', p.email ? emailKey(p.email) : null),
    claimed('mobile_key', normaliseMobile(p.mobile)),
  ]);
  if (cols.error || byAccount === null || byEmail === null || byMobile === null) return off('off');
  const c = (cols.data ?? {}) as { starter_pack_bought_at?: string | null; starter_pack_snoozed_until?: string | null };
  const status = accountStatus(p);
  const offer = packOffer(
    {
      createdAt: p.created_at,
      teamMember: team.role === 'member',
      bought: Boolean(c.starter_pack_bought_at),
      alreadyHad: byAccount || byEmail || byMobile,
      onPlan: status === 'paid' || status === 'subscription_trial' || status === 'paused',
    },
    lc,
  );
  const snoozedUntil = c.starter_pack_snoozed_until ?? null;
  return {
    offer,
    showTodayCard: todayCardShown(offer, snoozedUntil, new Date()),
    snoozedUntil,
    copy,
    pricePence: lc.starterPackPricePence,
    creditPence: lc.starterPackCreditPence,
  };
}

/** The member's pack state, read once per request however many surfaces ask. */
export const starterPackStateFor = cache(async (userId: string): Promise<PackState> => {
  try {
    return await load(userId);
  } catch (err) {
    console.warn('[starter-pack] state not read:', err instanceof Error ? err.message : String(err));
    const settings = await getBillingSettings();
    return {
      offer: { eligible: false, reason: 'off' },
      showTodayCard: false,
      snoozedUntil: null,
      copy: packCopy(settings.lifecycle, settings.dealPricing.fullAnalysisPence, settings.spendRates),
      pricePence: settings.lifecycle.starterPackPricePence,
      creditPence: settings.lifecycle.starterPackCreditPence,
    };
  }
});

/** "Not now" on the Today card: hidden for the snooze days. Recorded, never weekly active. */
export async function snoozeStarterPack(userId: string, surface: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const days = (await getBillingSettings()).lifecycle.starterPackSnoozeDays;
  const { error } = await createAdminClient().from('profiles').update({ starter_pack_snoozed_until: snoozeUntil(new Date(), days) }).eq('id', userId);
  logActivity(userId, 'starter_pack_not_now', { extras: { surface: surfaceToken(surface) } });
  return !error;
}

/** The offer was on screen: recorded once a day per surface, never weekly active. */
export function recordPackShown(userId: string, surface: string, now: Date = new Date()): void {
  const s = surfaceToken(surface);
  logActivity(userId, 'starter_pack_shown', { extras: { surface: s }, dedupeKey: `starter_pack_shown:${s}:${todayKey(now)}` });
}

const SURFACES = new Set(['welcome', 'today', 'account', 'deal', 'modal', 'banner', 'letter']);
function surfaceToken(surface: string): string {
  return SURFACES.has(surface) ? surface : 'other';
}

/** The latest purchase attempt in the last day, for the page Stripe returns the member to. */
export async function latestPurchaseFor(userId: string): Promise<{ status: 'reserved' | 'granted' | 'blocked' | 'failed'; blockedBy: string | null } | null> {
  if (!hasServiceRole()) return null;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error } = await createAdminClient().from('starter_pack_purchases').select('status, blocked_by').eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  const row = data[0] as { status: 'reserved' | 'granted' | 'blocked' | 'failed'; blocked_by: string | null };
  return { status: row.status, blockedBy: row.blocked_by };
}
