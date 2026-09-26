import 'server-only';

/**
 * Reads the offer range's discount bands (offer-rules.ts) from
 * billing_settings, with a short cache like getBillingSettings so My deals
 * does not add a round trip per page. Writes go through the existing
 * updateBillingSetting; the admin action calls invalidateOfferRules after.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { NO_OFFER_RULES, OFFER_RULES_KEY, parseOfferRules, type OfferRules } from './offer-rules';

const CACHE_MS = 60_000;
let cache: { at: number; raw: unknown } | null = null;

export function invalidateOfferRules(): void {
  cache = null;
}

/** The stored value as it is, for the admin form. Null when nothing is stored or it cannot be read. */
export async function getStoredOfferRules(): Promise<unknown> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.raw;
  if (!hasServiceRole()) return null;
  const { data, error } = await createAdminClient().from('billing_settings').select('value').eq('key', OFFER_RULES_KEY).maybeSingle();
  if (error) {
    console.warn('[offer-rules] read failed:', error.message);
    return null;
  }
  const raw = (data as { value?: unknown } | null)?.value ?? null;
  cache = { at: Date.now(), raw };
  return raw;
}

/** The bands in force. Not set, or not valid, reads as not set: never a guessed default. */
export async function getOfferRules(): Promise<OfferRules> {
  const raw = await getStoredOfferRules();
  return raw === null ? NO_OFFER_RULES : parseOfferRules(raw);
}
