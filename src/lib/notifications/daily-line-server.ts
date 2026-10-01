import 'server-only';

import { payerFor } from '../team';
import { quoterFor } from '../credit/quote-server';
import { dailyDealsLineFor, dailyDealsMode } from '../listing/daily-deals';

/**
 * What daily deals cost THIS member, worded for the Notifications panel and
 * the welcome notification choices (Batch 22): one source, so both say the
 * same thing.
 */
export async function dailyPriceLineFor(userId: string, adminUser: boolean): Promise<string> {
  const quoter = await quoterFor((await payerFor(userId)).payerId, adminUser);
  const dailyPence = quoter.pricing.todays5DailyPence;
  const dailyLine = dailyDealsLineFor(quoter.label(quoter.admin ? 0 : dailyPence), dailyPence);
  const from = quoter.pricing.newPricingFrom ? new Date(quoter.pricing.newPricingFrom) : null;
  return quoter.admin
    ? 'Admin account: never charged.'
    : dailyDealsMode(quoter.pricing) === 'per_day'
      ? `${dailyLine}.`
      : from && Number.isFinite(from.getTime())
        ? `Until ${from.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })} each pick is charged from your credit, its price shown with it. From then: ${dailyLine}.`
        : 'Each pick is charged from your credit, its price shown with it.';
}
