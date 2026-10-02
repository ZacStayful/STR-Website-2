import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { reserveAnalysis, runAnalysis } from '@/lib/analysis/run';
import { analysisComplete } from '@/lib/analysis/reuse';
import { actionSpend, refundAction } from '@/lib/credit/action';
import { InsufficientCreditError, getBalance } from '@/lib/credit/ledger';
import { getFunnel } from '@/lib/funnels';
import { analysisBilling, finishFunnelLead, quoteFunnelLead } from '@/lib/funnels/charge-server';
import { raiseFunnelAlert } from '@/lib/funnels/alerts';
import { reserveSpend, settleSpend } from '@/lib/funnels/caps';
import { completeLead, leaseQueuedLead } from '@/lib/leads/store';
import { queuedAnalysisInput } from '@/lib/leads/queue-input';

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
 *
 * Batch 21:
 *   - D10: a lead is claimed (src/lib/leads/store.ts leaseQueuedLead) before
 *     anything is reserved, so two runs in the same minute cannot both run
 *     and charge it.
 *   - D13: no new lead is started once START_BUDGET_MS has gone; a run that
 *     reaches the function's limit is killed with its spend reservation
 *     unsettled, and five full analyses do not fit in sixty seconds.
 *   - C4: a lead is run with the input the prospect gave (leads.input), not
 *     rebuilt from its address, postcode and bedrooms alone.
 *   - C3: a run that fails, or comes back without short-let figures, is
 *     refunded and the day's spend settled to what stayed charged.
 *
 * Batch 22f: priced like the live form (src/lib/funnels/charge-server.ts):
 * an owner on tiers is held at their next lead's price and charged once the
 * report is complete, never twice for the same lead (the live form may have
 * charged it already); the owner gets the new-lead email.
 */

export const maxDuration = 60;

/** Kept small: each lead is a full analysis, and the cron has 60 seconds. */
const MAX_PER_RUN = 5;
/** Older than this and the prospect has moved on; do not spend on it. */
const MAX_AGE_DAYS = 14;
/** No new lead is started after this long into the run (D13). */
const START_BUDGET_MS = 15_000;

interface QueuedLead {
  id: string;
  user_id: string;
  funnel_id: string | null;
  address: string | null;
  postcode: string | null;
  bedrooms: number | null;
  created_at: string;
  /** Batch 21a's column; absent until the schema is applied. */
  input?: unknown;
}

const LEAD_COLUMNS = 'id, user_id, funnel_id, address, postcode, bedrooms, created_at';

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return new Response('Not found', { status: 404 });
  if (!authoriseInternal(request)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'service role not configured' }, { status: 503 });

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const admin = createAdminClient();
  const started = Date.now();
  const cutoff = new Date(started - MAX_AGE_DAYS * 86_400_000).toISOString();

  const queuedLeads = (columns: string) =>
    admin
      .from('leads')
      .select(columns)
      .eq('status', 'queued')
      // An archived lead is one the customer chose to drop: running its report
      // now would charge them for it.
      .is('archived_at', null)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(MAX_PER_RUN);

  // With the stored input when the column exists (Batch 21a); without it, as
  // before, on a database that is behind on the schema.
  let read = await queuedLeads(`${LEAD_COLUMNS}, input`);
  if (read.error && /input/i.test(read.error.message)) read = await queuedLeads(LEAD_COLUMNS);
  if (read.error) {
    console.error('[funnel-queue] read failed:', read.error.message);
    return Response.json({ error: read.error.message }, { status: 500 });
  }

  const queued = (read.data ?? []) as unknown as QueuedLead[];
  const outcomes: Array<{ leadId: string; outcome: string }> = [];

  for (const lead of queued) {
    if (Date.now() - started > START_BUDGET_MS) {
      outcomes.push({ leadId: lead.id, outcome: 'out_of_time' });
      continue;
    }
    if (!lead.funnel_id || !lead.address || !lead.postcode) {
      outcomes.push({ leadId: lead.id, outcome: 'incomplete' });
      continue;
    }
    const funnel = await getFunnel(lead.user_id, lead.funnel_id);
    if (!funnel) {
      outcomes.push({ leadId: lead.id, outcome: 'funnel_gone' });
      continue;
    }

    const input = queuedAnalysisInput(lead, { enhanced: funnel.reportDepth === 'enhanced' });
    if (!input) {
      outcomes.push({ leadId: lead.id, outcome: 'unparseable' });
      continue;
    }

    const quote = await quoteFunnelLead(funnel);
    const billing = analysisBilling(quote);

    // Still short: leave it queued and try again next run.
    const balance = await getBalance(funnel.userId).catch(() => null);
    if (!balance || balance.spendableBasePence < quote.holdBasePence) {
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
    // Ours, or somebody else's: the funnel's own run of a fresh lead, or an
    // overlapping drain, holds the lease.
    if (!(await leaseQueuedLead(lead.id))) {
      outcomes.push({ leadId: lead.id, outcome: 'claimed_elsewhere' });
      continue;
    }
    if (!(await reserveSpend(funnel.id, quote.holdBasePence, funnel.dailySpendCapPence))) {
      outcomes.push({ leadId: lead.id, outcome: 'daily_spend_cap' });
      continue;
    }

    let actual = 0;
    let prepared: Awaited<ReturnType<typeof reserveAnalysis>> | null = null;
    try {
      prepared = await reserveAnalysis(input, {
        billedUserId: funnel.userId,
        ...billing,
        requireCredit: true,
        funnelId: funnel.id,
      });
      const { result, spend } = await runAnalysis(prepared, input, {
        billedUserId: funnel.userId,
        ...billing,
        requireCredit: true,
      });
      actual = spend.basePence;
      // No short-let figures is no report: refunded, not saved, run again
      // another time.
      if (!analysisComplete(result)) {
        await refundAction(prepared.ctx.actionId, 'Report could not get short-let figures').catch(() => 0);
        actual = (await actionSpend(prepared.ctx.actionId).catch(() => ({ basePence: 0, chargedPence: 0 }))).basePence;
        outcomes.push({ leadId: lead.id, outcome: 'no_figures' });
        continue;
      }
      // Reported apart from 'ran'. This used to say 'ran' whatever happened,
      // so a lead whose report could not be saved looked identical in the
      // cron's own output to one that worked — while being the case that
      // costs the customer a second charge.
      const attached = await completeLead({
        leadId: lead.id,
        result,
        rules: funnel.leadRules,
        unqualifiedPolicy: funnel.unqualifiedPolicy,
      });
      const charged = await finishFunnelLead({
        funnel,
        leadId: lead.id,
        quote,
        actionId: prepared.ctx.actionId,
        secondOpinionDelivered: Boolean(result.secondOpinion),
        saved: Boolean(attached),
      });
      if (quote.mode === 'tiers') actual = charged;
      outcomes.push({ leadId: lead.id, outcome: attached ? 'ran' : 'ran_unsaved' });
    } catch (err) {
      // Stays queued either way — a failure here must not lose the lead. What
      // the failed run had charged is given back.
      if (prepared) {
        await refundAction(prepared.ctx.actionId, 'Report failed').catch(() => 0);
        actual = (await actionSpend(prepared.ctx.actionId).catch(() => ({ basePence: 0, chargedPence: 0 }))).basePence;
      }
      const reason = err instanceof InsufficientCreditError ? 'insufficient_credit' : 'failed';
      if (reason === 'failed') console.error('[funnel-queue] run failed:', err);
      outcomes.push({ leadId: lead.id, outcome: reason });
    } finally {
      await settleSpend(funnel.id, quote.holdBasePence, actual).catch(() => {});
    }
  }

  return Response.json({ considered: queued.length, dry, outcomes, ms: Date.now() - started });
}
