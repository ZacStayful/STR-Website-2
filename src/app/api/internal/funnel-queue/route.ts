import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { parseAnalysisInput } from '@/lib/analysis/input';
import { reserveAnalysis, runAnalysis } from '@/lib/analysis/run';
import { InsufficientCreditError, getBalance } from '@/lib/credit/ledger';
import { getUnitCostTable, getBillingSettings } from '@/lib/credit/unit-costs';
import { estimateAction, reportAction } from '@/lib/credit/estimate';
import { getFunnel } from '@/lib/funnels';
import { raiseFunnelAlert } from '@/lib/funnels/alerts';
import { reserveSpend, settleSpend } from '@/lib/funnels/caps';
import { completeLead } from '@/lib/leads/store';
import { defaultGuests } from '@/lib/listing/normalise';

/**
 * Runs the reports for leads captured while their funnel's owner was short
 * of credit.
 *
 * The funnel deliberately keeps the enquiry and skips the report when a
 * balance will not cover it — losing a real prospect because a balance ran
 * dry is the outcome worth designing against. This is the other half of
 * that promise: once a top-up lands, the report runs and the lead becomes
 * a normal one.
 *
 * Same auth as the other internal routes: Vercel Cron's bearer or the shared
 * header. A run costs the customer money, so it never runs open.
 */

export const maxDuration = 60;

/** Kept small: each lead is a full analysis, and the cron has 60 seconds. */
const MAX_PER_RUN = 5;
/** Older than this and the prospect has moved on; do not spend on it. */
const MAX_AGE_DAYS = 14;

interface QueuedLead {
  id: string;
  user_id: string;
  funnel_id: string | null;
  address: string | null;
  postcode: string | null;
  bedrooms: number | null;
  created_at: string;
}

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return new Response('Not found', { status: 404 });
  if (!authoriseInternal(request)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'service role not configured' }, { status: 503 });

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();

  const { data, error } = await admin
    .from('leads')
    .select('id, user_id, funnel_id, address, postcode, bedrooms, created_at')
    .eq('status', 'queued')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) {
    console.error('[funnel-queue] read failed:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const queued = (data ?? []) as QueuedLead[];
  const outcomes: Array<{ leadId: string; outcome: string }> = [];

  for (const lead of queued) {
    if (!lead.funnel_id || !lead.address || !lead.postcode) {
      outcomes.push({ leadId: lead.id, outcome: 'incomplete' });
      continue;
    }
    const funnel = await getFunnel(lead.user_id, lead.funnel_id);
    if (!funnel) {
      outcomes.push({ leadId: lead.id, outcome: 'funnel_gone' });
      continue;
    }

    const parsed = parseAnalysisInput({
      address: lead.address,
      postcode: lead.postcode,
      bedrooms: lead.bedrooms ?? 2,
      guests: defaultGuests(lead.bedrooms ?? 2),
      enhanced: funnel.reportDepth === 'enhanced',
    });
    if (!parsed.ok) {
      outcomes.push({ leadId: lead.id, outcome: 'unparseable' });
      continue;
    }

    const settings = await getBillingSettings();
    const markupOverride = settings.funnelMarkup;
    const estimate = estimateAction(await getUnitCostTable(), reportAction(funnel.reportDepth === 'enhanced'), { markupOverride });

    // Still short: leave it queued and try again next run.
    const balance = await getBalance(funnel.userId).catch(() => null);
    if (!balance || balance.spendableBasePence < estimate.maxBasePence) {
      // Says it once a day rather than once every thirty minutes. A lead can
      // sit here for a fortnight, and the owner may well not have been on the
      // submission that first queued it — a report they are still waiting for
      // is worth a reminder the next morning.
      if (!dry) await raiseFunnelAlert('out_of_credit', funnel);
      outcomes.push({ leadId: lead.id, outcome: 'still_short' });
      continue;
    }
    if (dry) {
      outcomes.push({ leadId: lead.id, outcome: 'would_run' });
      continue;
    }
    if (!(await reserveSpend(funnel.id, estimate.maxBasePence, funnel.dailySpendCapPence))) {
      outcomes.push({ leadId: lead.id, outcome: 'daily_spend_cap' });
      continue;
    }

    let actual = 0;
    try {
      const prepared = await reserveAnalysis(parsed.input, {
        billedUserId: funnel.userId,
        markupOverride,
        requireCredit: true,
        funnelId: funnel.id,
      });
      const { result, spend } = await runAnalysis(prepared, parsed.input, {
        billedUserId: funnel.userId,
        markupOverride,
        requireCredit: true,
      });
      actual = spend.basePence;
      await completeLead({
        leadId: lead.id,
        result,
        rules: funnel.leadRules,
        unqualifiedPolicy: funnel.unqualifiedPolicy,
      });
      outcomes.push({ leadId: lead.id, outcome: 'ran' });
    } catch (err) {
      // Stays queued either way — a failure here must not lose the lead.
      const reason = err instanceof InsufficientCreditError ? 'insufficient_credit' : 'failed';
      if (reason === 'failed') console.error('[funnel-queue] run failed:', err);
      outcomes.push({ leadId: lead.id, outcome: reason });
    } finally {
      await settleSpend(funnel.id, estimate.maxBasePence, actual).catch(() => {});
    }
  }

  return Response.json({ considered: queued.length, dry, outcomes });
}
