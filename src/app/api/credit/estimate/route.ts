import { currentMember } from '@/lib/credit/auth';
import { estimateAction, type CreditAction } from '@/lib/credit/estimate';
import { getUnitCostTable } from '@/lib/credit/unit-costs';
import { getBalance } from '@/lib/credit/ledger';
import { paidFrom, toGrantPence } from '@/lib/credit/pricing';
import { isEnforcing } from '@/lib/credit/http';
import { typicalActionSpend } from '@/lib/credit/history';

export const dynamic = 'force-dynamic';

const ACTIONS: CreditAction[] = ['report', 'quick_view', 'narrate', 'speak', 'autocomplete', 'geocode'];

/**
 * GET ?action=report — what the action will cost and whether the member can
 * afford it. Typical = median of recent real runs when we have them.
 */
export async function GET(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const url = new URL(request.url);
  const action = url.searchParams.get('action') as CreditAction | null;
  if (!action || !ACTIONS.includes(action)) return Response.json({ error: 'Unknown action.' }, { status: 400 });

  const table = await getUnitCostTable();
  const est = estimateAction(table, action, { pmiSecondOpinion: process.env.PMI_SECOND_OPINION !== 'false', priceLabs: process.env.PRICELABS_AS_PRIMARY === 'true' });
  const [balance, typical] = await Promise.all([getBalance(member.id), action === 'report' ? typicalActionSpend('report') : Promise.resolve(null)]);
  const typicalBasePence = typical ?? est.typicalBasePence;
  const from = member.admin ? 'plan' : paidFrom(balance.buckets, typicalBasePence, balance.rates);
  const sufficient = member.admin || !isEnforcing() || balance.spendableBasePence >= est.maxBasePence;
  return Response.json(
    {
      action,
      typicalBasePence,
      maxBasePence: est.maxBasePence,
      planCreditPence: typicalBasePence,
      topupCreditPence: toGrantPence(typicalBasePence, balance.rates.topup),
      maxTopupCreditPence: toGrantPence(est.maxBasePence, balance.rates.topup),
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
