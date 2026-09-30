import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { isEnforcing } from '../credit/http';
import { stripeConfigured } from '../stripe/client';
import { priceIdForStarterPack } from '../stripe/prices';
import { packLive } from './rules';
import type { LifecycleSettings } from '../lifecycle/settings';

/**
 * What /admin/lifecycle shows about the starter pack (Batch 20): whether it
 * can be sold (Stripe, its price, credit enforcement, the webhook actually
 * arriving) and how many have been bought, refused or failed.
 */
export interface PackAdminStatus {
  state: 'off' | 'scheduled' | 'live';
  stripe: boolean;
  priceSet: boolean;
  enforcing: boolean;
  lastStripeEvent: { type: string; receivedAt: string; error: string | null } | null;
  counts: { granted: number; reserved: number; blocked: number; failed: number } | null;
  warnings: string[];
}

async function count(status: string): Promise<number | null> {
  const { count: n, error } = await createAdminClient().from('starter_pack_purchases').select('payment_intent_id', { count: 'exact', head: true }).eq('status', status);
  return error ? null : (n ?? 0);
}

export async function packAdminStatus(s: LifecycleSettings, now: Date = new Date()): Promise<PackAdminStatus> {
  const state = !s.starterPackFrom ? 'off' : packLive(s, now) ? 'live' : 'scheduled';
  const stripe = stripeConfigured();
  const priceSet = Boolean(priceIdForStarterPack());
  const enforcing = isEnforcing();
  let lastStripeEvent: PackAdminStatus['lastStripeEvent'] = null;
  let counts: PackAdminStatus['counts'] = null;
  if (hasServiceRole()) {
    const [ev, granted, reserved, blocked, failed] = await Promise.all([
      createAdminClient().from('stripe_events').select('type, received_at, error').order('received_at', { ascending: false }).limit(1),
      count('granted'),
      count('reserved'),
      count('blocked'),
      count('failed'),
    ]);
    const row = (ev.data ?? [])[0] as { type: string; received_at: string; error: string | null } | undefined;
    if (row) lastStripeEvent = { type: row.type, receivedAt: row.received_at, error: row.error };
    if (granted !== null && reserved !== null && blocked !== null && failed !== null) counts = { granted, reserved, blocked, failed };
  }
  const warnings: string[] = [];
  if (state !== 'off') {
    if (!stripe) warnings.push('Stripe is not configured (STRIPE_SECRET_KEY): the pack cannot be sold.');
    if (!priceSet) warnings.push('STRIPE_PRICE_STARTER_PACK is not set: the pack cannot be sold. Create a one-off GBP price for the pack’s price in Stripe and set its id.');
    if (!enforcing) warnings.push('Credit is not enforced (CREDIT_ENFORCE is not "true"): members at £0 can still run everything, so the pack buys nothing they need.');
    if (!lastStripeEvent) warnings.push('No Stripe webhook event has ever been received: packs are captured and granted by the webhook, so check the endpoint and its events (checkout.session.completed, payment_intent.succeeded, charge.refunded, charge.dispute.created) in Stripe.');
    if (counts === null) warnings.push('starter_pack_purchases is unreadable: run supabase/schema.sql (Batch 20 section).');
  }
  return { state, stripe, priceSet, enforcing, lastStripeEvent, counts, warnings };
}
