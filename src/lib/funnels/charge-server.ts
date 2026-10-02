import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { estimateAction, reportAction } from '../credit/estimate';
import { getBillingSettings, getUnitCostTable } from '../credit/unit-costs';
import { recordActivity } from '../activity/log';
import type { Funnel } from './index';
import { priceForLead, type FunnelTierSettings } from './tiers';
import { getFunnelTierSettings, ownerPricing } from './tiers-server';

/**
 * Batch 22f: how a funnel lead is priced and charged, for both doors that run
 * one (the live form, api/f/[token]/analyse, and the drain,
 * api/internal/funnel-queue).
 *
 * Tiers: the report runs as a fixed-price action (each provider call's raw
 * cost is logged; nothing is debited per call), and once it is complete —
 * the prospect has their report — one charge is made by funnel_lead_charge,
 * which numbers the lead in the owner's UK month and debits that number's
 * tier price in the same statement. A failed or incomplete run is therefore
 * never charged, and a lead is charged at most once whichever door finishes
 * it. The hold before the run is the price the NEXT lead would be: a
 * concurrent lead can only take a number after it, which is never dearer.
 *
 * Legacy (an owner from before tiers, until their notice runs out): exactly
 * as before, metered per call at funnel_markup.
 */

export interface LeadQuote {
  mode: 'tiers' | 'legacy';
  enhanced: boolean;
  /** Base pence the owner must be able to cover, and the daily spend cap's claim. */
  holdBasePence: number;
  /** Legacy only: the per-call markup. */
  markupOverride?: number;
  settings: FunnelTierSettings;
}

export async function quoteFunnelLead(funnel: Pick<Funnel, 'userId' | 'reportDepth'>): Promise<LeadQuote> {
  const enhanced = funnel.reportDepth === 'enhanced';
  const settings = await getFunnelTierSettings();
  const pricing = await ownerPricing(funnel.userId, settings);
  if (pricing.mode === 'tiers') {
    return { mode: 'tiers', enhanced, holdBasePence: priceForLead(pricing.monthCount + 1, enhanced, settings), settings };
  }
  const markupOverride = (await getBillingSettings()).funnelMarkup;
  const estimate = estimateAction(await getUnitCostTable(), reportAction(enhanced), { markupOverride });
  return { mode: 'legacy', enhanced, holdBasePence: estimate.maxBasePence, markupOverride, settings };
}

/** What reserveAnalysis / runAnalysis are given for this quote. */
export function analysisBilling(q: LeadQuote): { markupOverride?: number; fixedPrice?: boolean; reserveBasePence?: number } {
  return q.mode === 'tiers' ? { fixedPrice: true, reserveBasePence: q.holdBasePence } : { markupOverride: q.markupOverride };
}

export interface LeadCharge {
  n: number;
  basePence: number;
  already: boolean;
}

/**
 * Charges a finished lead at its tier. Null for a legacy quote (already
 * metered) or when the charge could not be made — logged loudly, never
 * retried into a double charge (the guard row makes a retry return the
 * first charge anyway).
 */
export async function chargeFunnelLead(o: { funnel: Pick<Funnel, 'id' | 'userId' | 'name'>; leadId: string; quote: LeadQuote; actionId: string | null }): Promise<LeadCharge | null> {
  if (o.quote.mode !== 'tiers' || !hasServiceRole()) return null;
  try {
    const { data, error } = await createAdminClient().rpc('funnel_lead_charge', {
      p: {
        owner: o.funnel.userId,
        lead: o.leadId,
        funnel: o.funnel.id,
        enhanced: o.quote.enhanced,
        tiers: o.quote.settings.tiers,
        enhanced_extra: o.quote.settings.enhancedExtraPence,
        meta: {
          action: 'funnel_lead',
          provider: 'funnel',
          unit: o.quote.enhanced ? 'lead_enhanced' : 'lead',
          description: `Funnel lead — ${o.funnel.name}`.slice(0, 200),
          // Deliberately NOT action_id: the routes refund every debit under the
          // run's action id when anything after the run throws (a prospect
          // closing the tab mid-stream), and a delivered lead's charge must not
          // be refunded by that. The run is kept for tracing under its own key.
          ...(o.actionId ? { run_action_id: o.actionId } : {}),
        },
      },
    });
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as { n?: unknown; base_pence?: unknown; already?: unknown };
    const charge: LeadCharge = { n: Number(r.n) || 0, basePence: Number(r.base_pence) || 0, already: r.already === true };
    if (!charge.already) {
      // Record only: keeps an owner who only reads their leads by email out
      // of Re-engage, without counting as weekly active (src/lib/inactivity/rules.ts).
      await recordActivity(o.funnel.userId, 'funnel_lead_charged', {
        dedupeKey: `funnel_lead_charged:${o.leadId}`,
        extras: { n: charge.n, pence: charge.basePence, enhanced: o.quote.enhanced },
      }).catch(() => {});
      void import('../credit/after-debit').then((m) => m.afterDebit(o.funnel.userId)).catch(() => {});
    }
    return charge;
  } catch (err) {
    console.error(`[funnel-charge] lead ${o.leadId} ran but could not be charged:`, err);
    return null;
  }
}

/**
 * Everything after a lead's report is complete, for both doors: the tier
 * charge (tiers only; an enhanced report whose second opinion did not arrive
 * is charged as standard, as the metered price refunded it) and, once the
 * report is saved on the lead, the owner's new-lead email. Never throws.
 * Returns the base pence charged (0 for legacy, already-charged or failed).
 */
export async function finishFunnelLead(o: {
  funnel: Pick<Funnel, 'id' | 'userId' | 'name'>;
  leadId: string;
  quote: LeadQuote;
  actionId: string | null;
  secondOpinionDelivered: boolean;
  saved: boolean;
}): Promise<number> {
  const quote = o.quote.enhanced && !o.secondOpinionDelivered ? { ...o.quote, enhanced: false } : o.quote;
  const charge = await chargeFunnelLead({ funnel: o.funnel, leadId: o.leadId, quote, actionId: o.actionId });
  if (o.saved) {
    const { notifyOwnerOfLead } = await import('./new-lead-server');
    await notifyOwnerOfLead({ leadId: o.leadId, funnelId: o.funnel.id, ownerId: o.funnel.userId, funnelName: o.funnel.name });
  }
  return charge && !charge.already ? charge.basePence : 0;
}
