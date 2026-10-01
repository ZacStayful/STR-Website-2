import 'server-only';

import { getBillingSettings } from '../credit/unit-costs';
import { packCopy, packLive, publicOffer, type PackCopy, type PublicOffer } from './rules';

/**
 * The public pages' offer as it stands now (Batch 20): the welcome credit
 * until billing_settings.starter_pack_from, the starter pack from then.
 */
export async function publicOfferNow(now: Date = new Date()): Promise<PublicOffer & { copy: PackCopy }> {
  const settings = await getBillingSettings();
  const copy = packCopy(settings.lifecycle, settings.dealPricing.fullAnalysisPence, settings.spendRates, { freeDealDelayHours: settings.freeDealDelayHours });
  return { ...publicOffer(copy, packLive(settings.lifecycle, now), settings.welcomeGrantPence), copy };
}
