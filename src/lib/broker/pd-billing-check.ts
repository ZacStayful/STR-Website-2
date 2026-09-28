import 'server-only';

/**
 * Does PropertyData bill a failed call? The meter logs failed attempts at 0p
 * by design, which is only right if PropertyData does not charge for them.
 * During the 12–25 Sep valuation-rent loop 21,368 of 22,580 calls failed;
 * billed at a credit each, that loop cost far more than the £36 logged.
 *
 * The check: read the (free) credit balance, make one call PropertyData is
 * known to fail (a rent for S1 2HH, which it never values), read the balance
 * again, and take off any other paid PropertyData calls that ran meanwhile.
 * At most one credit (~2.5p), house spend. Run from /admin/billing; each run
 * is recorded in marketplace_runs (kind 'pd_billing_check').
 */
import { createAdminClient } from '../supabase/admin';
import { runMetered, newActionId } from '../credit/context';
import { pdAccountCredits, pdClient, propertyDataConfigured } from './providers/propertydata';
import { longLetAttemptParams } from '../apis/propertydata-parse';

/** A postcode PropertyData never valued: 1,465 failed attempts on it, 18–25 Sep. */
const KNOWN_FAILING = { postcode: 'S1 2HH', bedrooms: 2 };
/** PropertyData's counter can take a moment to move. */
const SETTLE_MS = 3_000;

export interface PdBillingCheck {
  verdict: 'billed' | 'not_billed' | 'inconclusive';
  detail: string;
  creditsBefore: number | null;
  creditsAfter: number | null;
  /** Other paid PropertyData calls logged while the check ran. */
  otherPaidCalls: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function inconclusive(detail: string, extra: Partial<PdBillingCheck> = {}): PdBillingCheck {
  return { verdict: 'inconclusive', detail, creditsBefore: null, creditsAfter: null, otherPaidCalls: null, ...extra };
}

export async function runPropertyDataFailedCallCheck(triggeredBy: string): Promise<PdBillingCheck> {
  const result = await check();
  try {
    const now = new Date().toISOString();
    await createAdminClient().from('marketplace_runs').insert({ kind: 'pd_billing_check', dry: false, started_at: now, finished_at: now, summary: { ...result, triggeredBy } });
  } catch (err) {
    console.error('[pd-billing-check] record failed:', (err as Error)?.message ?? err);
  }
  return result;
}

async function check(): Promise<PdBillingCheck> {
  if (!propertyDataConfigured()) return inconclusive('PROPERTYDATA_API_KEY is not set here.');
  const before = await pdAccountCredits();
  if (!before || before.used === null) return inconclusive('The credit balance could not be read.');
  if ((before.remaining ?? 0) <= 0) return inconclusive('No credit left this month: a failed call cannot be billed now, so the check would say nothing.', { creditsBefore: before.used });
  const admin = createAdminClient();
  const actionId = newActionId();
  const startedAt = new Date().toISOString();
  const rent = await runMetered({ userId: null, admin: false, action: 'admin:pd-billing-check', actionId }, () => pdClient.valuationRent(longLetAttemptParams(KNOWN_FAILING.postcode, KNOWN_FAILING.bedrooms)[0]));
  if (rent) return inconclusive('PropertyData valued that postcode this time, so the call succeeded (and was billed normally): it says nothing about failed calls.', { creditsBefore: before.used });
  const { count: ours } = await admin.from('provider_calls').select('id', { count: 'exact', head: true }).eq('action_id', actionId);
  if (!ours) return inconclusive('The call was not made (PropertyData is paused after hitting its plan limit, or the call could not be logged).', { creditsBefore: before.used });
  await sleep(SETTLE_MS);
  const after = await pdAccountCredits();
  const endedAt = new Date().toISOString();
  if (!after || after.used === null) return inconclusive('The credit balance could not be read after the call.', { creditsBefore: before.used });
  const { count: others, error } = await admin
    .from('provider_calls')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'propertydata')
    .eq('ok', true)
    .eq('cache_hit', false)
    .gt('cost_pence', 0)
    .gte('at', startedAt)
    .lte('at', endedAt);
  if (error) return inconclusive('Other PropertyData calls in the window could not be counted.', { creditsBefore: before.used, creditsAfter: after.used });
  const failedCallCredits = after.used - before.used - (others ?? 0);
  const base = { creditsBefore: before.used, creditsAfter: after.used, otherPaidCalls: others ?? 0 };
  if (failedCallCredits >= 1) return { verdict: 'billed', detail: `The failed call used ${failedCallCredits} credit${failedCallCredits === 1 ? '' : 's'}: failed PropertyData calls are billed, so logging them at 0p under-reports spend.`, ...base };
  if (failedCallCredits === 0) return { verdict: 'not_billed', detail: 'The failed call used no credit: logging failed PropertyData calls at 0p is right.', ...base };
  return { verdict: 'inconclusive', detail: `The balance moved by ${after.used - before.used} while ${others ?? 0} other paid calls ran: run it again when the site is quiet.`, ...base };
}
