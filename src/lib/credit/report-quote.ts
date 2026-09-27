import 'server-only';

import { estimateAction } from './estimate';
import { getUnitCostTable } from './unit-costs';
import { typicalActionSpend } from './history';
import { quoterFor } from './quote-server';

/**
 * What a standard full report will cost this account, for the "Full report ·
 * about £4.85" button on a deal. The same figures /api/credit/estimate gives
 * the analyser (so the button and the analyser agree): the median of recent
 * real runs when there are enough, else the unit-cost estimate, walked
 * through this account's own grants (each at its own rate, the order the
 * ledger takes them), so it is what their balance will move by. Null for an
 * admin (never charged) or when it cannot be worked out; the button then
 * shows no price rather than a wrong one.
 */
export async function reportQuotePence(payerId: string, adminUser: boolean): Promise<number | null> {
  if (adminUser) return null;
  try {
    const table = await getUnitCostTable();
    const est = estimateAction(table, 'report', { priceLabs: process.env.PRICELABS_AS_PRIMARY === 'true' });
    const [quoter, typical] = await Promise.all([quoterFor(payerId, false), typicalActionSpend('report')]);
    const quote = quoter.quote(typical ?? est.typicalBasePence);
    return quote.facePence + quote.shortfallBasePence;
  } catch (err) {
    console.warn('[report-quote] failed:', (err as Error)?.message ?? err);
    return null;
  }
}

/** "£4.85", as the analyser writes a credit amount. */
export function formatQuote(pence: number): string {
  return `£${(Math.max(0, pence) / 100).toFixed(2)}`;
}
