import 'server-only';

/**
 * Batch 22, Part H: the member's side of the analysis offers (offers.ts):
 * the reveal's deals and when it was first viewed, who pays, whether the
 * paying account has had a deep report, and today's raw-cost floors. Read by
 * the server for every price shown and every price charged; never trusted
 * from a page.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { payerFor } from '../team';
import { getBillingSettings, getUnitCostTable } from '../credit/unit-costs';
import { fullAnalysisRawCeiling } from '../credit/estimate';
import { priceFor } from '../credit/pricing';
import { analysisOffer, pmiAddonOffer, type Floors, type OfferMember, type OfferSettings, type OfferedPrices } from './offers';

const priceLabs = () => process.env.PRICELABS_AS_PRIMARY === 'true';

/** The worst-case raw costs offers are floored at, from the live unit costs. */
export async function offerFloors(): Promise<Floors> {
  const table = await getUnitCostTable();
  return {
    fullRawPence: fullAnalysisRawCeiling(table, { priceLabs: priceLabs() }),
    deepRawPence: fullAnalysisRawCeiling(table, { pmi: true, priceLabs: priceLabs() }),
    pmiRawPence: priceFor(table, 'pmi', 'str_estimate', 1).rawPence,
  };
}

export async function offerSettings(): Promise<OfferSettings> {
  const s = (await getBillingSettings()).intelligence;
  return { revealAnalysisDiscountPct: s.revealAnalysisDiscountPct, revealWelcomeDays: s.revealWelcomeDays, deepFirstRunExtraPence: s.deepFirstRunExtraPence };
}

/**
 * Has the paying account had a deep report (a completed purchase with PMI's
 * second opinion), or claimed its first one (a pending first-deep purchase)?
 * True on any read failure: the first-time price is never given by mistake.
 */
export async function hadDeepReport(payerId: string): Promise<boolean> {
  if (!hasServiceRole()) return true;
  const admin = createAdminClient();
  const [done, claimed] = await Promise.all([
    admin.from('analysis_purchases').select('id').eq('buyer_id', payerId).eq('status', 'complete').eq('second_opinion', true).limit(1),
    admin.from('analysis_purchases').select('id').eq('buyer_id', payerId).eq('first_deep', true).neq('status', 'failed').limit(1),
  ]);
  if (done.error || claimed.error) return true;
  return (done.data ?? []).length > 0 || (claimed.data ?? []).length > 0;
}

/** The member's offer state. Null when it cannot be read (the list price then applies). */
export async function offerMemberFor(userId: string): Promise<OfferMember | null> {
  if (!hasServiceRole()) return null;
  try {
    const admin = createAdminClient();
    const payer = await payerFor(userId);
    const [reveal, used, had] = await Promise.all([
      admin.from('signup_reveals').select('offer_deal_ids, viewed_at').eq('user_id', userId).maybeSingle(),
      admin.from('analysis_purchases').select('deal_id').eq('buyer_id', payer.payerId).in('offer', ['welcome', 'welcome_deep']).neq('status', 'failed'),
      hadDeepReport(payer.payerId),
    ]);
    const r = (reveal.error ? null : reveal.data) as { offer_deal_ids?: unknown; viewed_at?: string | null } | null;
    const offerDealIds = Array.isArray(r?.offer_deal_ids) ? (r!.offer_deal_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    return {
      offerDealIds,
      revealViewedAt: r?.viewed_at ?? null,
      paysForSelf: payer.payerId === userId,
      hadDeepReport: had,
      usedWelcomeOn: used.error ? offerDealIds : ((used.data ?? []) as { deal_id: string | null }[]).map((x) => x.deal_id).filter((x): x is string => Boolean(x)),
    };
  } catch (err) {
    console.error('[offers] member state unreadable:', (err as Error)?.message ?? err);
    return null;
  }
}

/** The prices a Full analysis / Deep report of this deal is offered at to this member now. */
export async function offeredPricesFor(userId: string, dealId: string, withPmi: boolean, now: Date = new Date()): Promise<OfferedPrices> {
  const [settings, member, floors, s] = await Promise.all([getBillingSettings(), offerMemberFor(userId), offerFloors(), offerSettings()]);
  return analysisOffer({ dealId, withPmi, list: { fullPence: settings.dealPricing.fullAnalysisPence, pmiPence: settings.dealPricing.pmiAddonPence }, member, settings: s, floors, now });
}

/** PMI added to a finished analysis: + the first-run extra the first time. */
export async function offeredPmiAddonFor(userId: string): Promise<ReturnType<typeof pmiAddonOffer>> {
  const [settings, floors, s] = await Promise.all([getBillingSettings(), offerFloors(), offerSettings()]);
  const payer = await payerFor(userId);
  return pmiAddonOffer({ listPmiPence: settings.dealPricing.pmiAddonPence, hadDeepReport: await hadDeepReport(payer.payerId), settings: s, floors });
}

/**
 * Batch 22: every price a page shows for a Full analysis or Deep report, with
 * this member's offers applied, loaded once per request. The card, the deal
 * page and the reveal all price through it, and startDealAnalysis re-works
 * the same offer, so the button and the charge always agree.
 */
export async function offerPricingFor(userId: string, adminUser: boolean, now: Date = new Date()) {
  const settings = await getBillingSettings();
  const list = { fullPence: settings.dealPricing.fullAnalysisPence, pmiPence: settings.dealPricing.pmiAddonPence };
  if (adminUser) return { pricing: () => settings.dealPricing, offer: (): OfferedPrices | null => null };
  const [member, floors, s] = await Promise.all([offerMemberFor(userId), offerFloors(), offerSettings()]);
  const offer = (dealId: string, withPmi: boolean) => analysisOffer({ dealId, withPmi, list, member, settings: s, floors, now });
  return {
    pricing: (dealId: string, withPmi: boolean) => {
      const o = offer(dealId, withPmi);
      return o.offer ? { ...settings.dealPricing, fullAnalysisPence: o.fullPence, pmiAddonPence: o.pmiPence } : settings.dealPricing;
    },
    offer: (dealId: string, withPmi: boolean) => {
      const o = offer(dealId, withPmi);
      return o.offer ? o : null;
    },
  };
}
