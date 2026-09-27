import { currentMember } from '@/lib/credit/auth';
import { estimateAction, type CreditAction } from '@/lib/credit/estimate';
import { getUnitCostTable } from '@/lib/credit/unit-costs';
import { toGrantPence } from '@/lib/credit/pricing';
import { isEnforcing } from '@/lib/credit/http';
import { typicalActionSpend } from '@/lib/credit/history';
import { quoterFor } from '@/lib/credit/quote-server';
import { quoteSource } from '@/lib/credit/deal-pricing';
import { getBalance } from '@/lib/credit/ledger';

export const dynamic = 'force-dynamic';

const ACTIONS: CreditAction[] = ['report', 'report_enhanced', 'quick_view', 'narrate', 'speak', 'autocomplete', 'geocode'];

/**
 * GET ?action=report — what the action will cost and whether the member can
 * afford it. Typical = median of recent real runs when we have them.
 *
 * The face amounts walk the member's own grants in the ledger's order and at
 * each grant's own rate (src/lib/credit/deal-pricing.ts), so "about £X" is
 * what this member's balance will actually move by, whatever mix of plan
 * and top-up credit pays it.
 */
export async function GET(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const url = new URL(request.url);
  const action = url.searchParams.get('action') as CreditAction | null;
  if (!action || !ACTIONS.includes(action)) return Response.json({ error: 'Unknown action.' }, { status: 400 });

  const table = await getUnitCostTable();
  const pmiAvailable = process.env.PMI_SECOND_OPINION !== 'false';
  const est = estimateAction(table, action, { pmiSecondOpinion: action === 'report_enhanced' && pmiAvailable, priceLabs: process.env.PRICELABS_AS_PRIMARY === 'true' });
  const [balance, typical, quoter] = await Promise.all([
    getBalance(member.payerId),
    action === 'report' || action === 'report_enhanced' ? typicalActionSpend(action) : Promise.resolve(null),
    quoterFor(member.payerId, member.admin),
  ]);
  const typicalBasePence = typical ?? est.typicalBasePence;
  const typicalQuote = quoter.quote(typicalBasePence);
  const maxQuote = quoter.quote(est.maxBasePence);
  const from = member.admin ? 'plan' : quoteSource(typicalQuote);
  const sufficient = member.admin || !isEnforcing() || balance.spendableBasePence >= est.maxBasePence;
  return Response.json(
    {
      action,
      typicalBasePence,
      maxBasePence: est.maxBasePence,
      planCreditPence: typicalBasePence,
      topupCreditPence: toGrantPence(typicalBasePence, balance.rates.topup),
      maxTopupCreditPence: toGrantPence(est.maxBasePence, balance.rates.topup),
      // What this member's balance moves by, from their own grants.
      typicalFacePence: member.admin ? 0 : typicalQuote.facePence + typicalQuote.shortfallBasePence,
      maxFacePence: member.admin ? 0 : maxQuote.facePence + maxQuote.shortfallBasePence,
      spendableBasePence: balance.spendableBasePence,
      availablePence: balance.totalPence,
      sufficient,
      paidFrom: from,
      rates: balance.rates,
      admin: member.admin,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
