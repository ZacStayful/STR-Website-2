import 'server-only';

/**
 * The £2 buy-to-let report (Batch 28, Part G): quote → claim → reserve →
 * run → debit, the path the PMI add-on takes (analysis/pmi-addon.ts), and
 * the one charging path a buy-to-let report has.
 *
 *   QUOTE    btl_report_pence (£2), or the welcome price on a deal the
 *            member's reveal showed (offers.ts btlReportOffer, once each).
 *   CLAIM    one pending report per account and listing
 *            (analysis_purchases_btl_running_uidx), so a double tap cannot
 *            buy it twice; an abandoned claim is let go.
 *   RUN      a rent valuation, a sale valuation, sold prices nearby, and the
 *            EPC, flood, planning and demand checks, through the broker and
 *            the meter (house cache first: a postcode seen recently costs
 *            nothing); then the buy-to-let figures with all of it folded in.
 *   CHARGE   only once the report is written. No figures, a provider outage
 *            or anything else that fails: nothing is charged, and the hold
 *            is let go.
 *
 * Never the address, the full postcode or the listing's link in what is
 * stored or shown: the report runs on them server-side only.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { payerFor } from '../team';
import { ask, pdLongLetRent, pdSaleValuation, pdSoldPrices } from '../broker';
import { COST_PENCE } from '../broker/config';
import { debit, getBalance, release, reserve, InsufficientCreditError } from '../credit/ledger';
import { isEnforcing } from '../credit/http';
import { afterDebit } from '../credit/after-debit';
import { startAction } from '../credit/action';
import { runMetered } from '../credit/context';
import { quoterFor } from '../credit/quote-server';
import { activeProfileIdOf } from '../profiles/server';
import { logActivity } from '../activity/log';
import { faceMatches, quoteMatches, ANALYSIS_STALE_MS } from '../analysis/deal-analysis-rules';
import { dueDiligenceFor } from '../analysis/propertydata-steps';
import { btlReportOffer, type OfferKind } from '../analysis/offers';
import { offerMemberFor, offerSettings } from '../analysis/offers-server';
import { dealVisibilityFor } from '../marketplace/tier';
import { dealVisibleTo } from '../marketplace/visibility';
import { loadDealById, loadSourcedListings } from '../marketplace/server';
import { dealListingFor } from '../marketplace/open';
import { mergeSnapshotIntoListing } from '../marketplace/record';
import type { SourcedListing } from '../listing/sourcing';
import { homeTypeOf } from '../project/value';
import { pdSoldTypeFor } from '../project/evidence';
import { regionForArea } from '../market/regions';
import { parseMarketGoals } from '../market/goals';
import { btlContextFor } from './context-server';
import { screenForBtl, valuationPropertyType } from './screen';
import { listingKind } from './listing';
import { isEpcRating } from './deal';
import { buildBtlReport, reportTitle, soldSummary, BTL_REPORT_MAX_CALLS, type BtlReport } from './report';
import { readBtlBenchmark, readBtlSettingsCached } from './settings-server';
import { btlLookerFor } from './view';
import { DEFAULT_BTL_PRIORITY, regionPhrase } from './today';

type Admin = ReturnType<typeof createAdminClient>;

export type BtlReportCode = 'missing' | 'not_sale' | 'no_postcode' | 'unsuitable' | 'no_figures' | 'seat_paused' | 'price_changed' | 'insufficient_credit' | 'running' | 'already_done' | 'failed';

/** `already_done` carries the member's report on that listing: it is opened again, never sold again. */
export type BtlReportResult = { ok: true; reportId: string; purchaseId: string; chargedBasePence: number } | { ok: false; code: BtlReportCode; message: string; pricePence?: number; requiredPence?: number; availablePence?: number; reportId?: string };

const MESSAGES: Record<BtlReportCode, string> = {
  missing: 'We couldn’t find that listing.',
  not_sale: 'A buy-to-let report is for a property for sale.',
  no_postcode: 'We couldn’t read this listing’s postcode, so it can’t be valued. Nothing was charged.',
  unsuitable: 'This one can’t be bought with a buy-to-let mortgage (cash buyers only, an auction lot, non-standard construction or a very short lease). Nothing was charged.',
  no_figures: 'We couldn’t work out a rent for this one, so there is no report to give. Nothing was charged.',
  seat_paused: 'Your seat on this team is paused, so you can’t spend the team’s credit.',
  price_changed: 'The price has changed since this page loaded. Nothing was charged; check the new price and try again.',
  insufficient_credit: 'Not enough credit for the buy-to-let report. Nothing was charged.',
  running: 'Your report is already on its way. Refresh in a moment.',
  already_done: 'You already have a buy-to-let report on this one, so it opens instead. Nothing was charged.',
  failed: 'Something went wrong making the report. Nothing was charged; please try again.',
};

function fail(code: BtlReportCode, extra: { pricePence?: number; requiredPence?: number; availablePence?: number } = {}): BtlReportResult {
  return { ok: false, code, message: MESSAGES[code], ...extra };
}

export function btlReportHttpStatus(code: BtlReportCode): number {
  if (code === 'missing') return 404;
  if (code === 'insufficient_credit' || code === 'seat_paused') return 402;
  if (code === 'already_done') return 200;
  if (code === 'running' || code === 'price_changed') return 409;
  if (code === 'not_sale' || code === 'no_postcode' || code === 'unsuitable' || code === 'no_figures') return 422;
  return 500;
}

/** The report's worst-case raw cost, pence: what the welcome price never goes under. */
export const BTL_REPORT_FLOOR_PENCE = BTL_REPORT_MAX_CALLS * COST_PENCE.propertydataCall;

export interface BtlReportTarget {
  dealId?: string | null;
  /** A sale listing the member looked at (sourced_listings), when there is no deal. */
  url?: string | null;
}

export interface BtlReportQuote {
  basePence: number;
  listPence: number;
  offer: Extract<OfferKind, 'welcome_btl'> | null;
}

/** What the report costs this member on this listing (the button and the charge both read it). */
export async function quoteBtlReport(userId: string, adminUser: boolean, target: BtlReportTarget, now: Date = new Date()): Promise<BtlReportQuote> {
  const admin = createAdminClient();
  const { settings } = await readBtlSettingsCached(admin);
  if (adminUser) return { basePence: 0, listPence: settings.reportPence, offer: null };
  const dealId = target.dealId ?? null;
  const [member, s, used] = await Promise.all([
    dealId ? offerMemberFor(userId).catch(() => null) : Promise.resolve(null),
    offerSettings(),
    dealId ? admin.from('analysis_purchases').select('id', { count: 'exact', head: true }).eq('buyer_id', userId).eq('offer', 'welcome_btl').neq('status', 'failed') : Promise.resolve({ count: 0, error: null }),
  ]);
  const o = btlReportOffer({ dealId, listPence: settings.reportPence, member, usedWelcomeBtl: Boolean(used.error) || (used.count ?? 0) > 0, settings: s, floorPence: BTL_REPORT_FLOOR_PENCE, now });
  return { basePence: o.pence, listPence: o.listPence, offer: o.offer };
}

/** The listing a report runs on: a deal (visible to this member) or a sale listing they looked at. Null when there is none. */
async function listingFor(admin: Admin, userId: string, adminUser: boolean, target: BtlReportTarget): Promise<{ listing: SourcedListing; dealId: string | null } | null> {
  if (target.dealId) {
    const deal = await loadDealById(admin, target.dealId);
    if (!deal) return null;
    // A free member's early-access window: the deal does not exist for them yet, nor its report.
    const visibility = await dealVisibilityFor(userId, adminUser);
    if (!dealVisibleTo({ id: deal.id, live_since: deal.live_since }, visibility)) return null;
    // The listing as its page last read it (the postcode and address the valuations need).
    const { listing, live } = await dealListingFor(admin, deal);
    if (!listing) return null;
    return { listing: live ? mergeSnapshotIntoListing(listing, live) : listing, dealId: deal.id };
  }
  const url = (target.url ?? '').trim();
  if (!url) return null;
  const found = (await loadSourcedListings(admin, [url])).get(url);
  return found ? { listing: found.listing, dealId: null } : null;
}

export async function runBtlReport(input: { userId: string; adminUser: boolean; target: BtlReportTarget; quotedBasePence: unknown; quotedFacePence?: unknown; now?: Date }): Promise<BtlReportResult> {
  if (!hasServiceRole()) return fail('failed');
  const now = input.now ?? new Date();
  const admin = createAdminClient();
  const found = await listingFor(admin, input.userId, input.adminUser, input.target);
  if (!found) return fail('missing');
  const l = found.listing;
  if (l.kind !== 'sale') return fail('not_sale');
  if (!l.postcode || l.bedrooms === null) return fail('no_postcode');
  // Charged once: a report the member already has on this listing opens again (a stale tab, Back, or asking the eye twice).
  const had = await reportIdsFor(admin, input.userId, { urls: [l.canonicalUrl] });
  const already = had?.values().next().value;
  if (already) return { ...fail('already_done'), reportId: already } as BtlReportResult;

  const payer = await payerFor(input.userId);
  if (payer.suspended) return fail('seat_paused');
  const quote = await quoteBtlReport(input.userId, input.adminUser, { dealId: found.dealId }, now);
  const price = quote.basePence;
  const mustAfford = isEnforcing() || Boolean(quote.offer);
  if (!quoteMatches(input.quotedBasePence, { purchaseBasePence: price })) return fail('price_changed', { pricePence: price });
  if (price > 0) {
    if (mustAfford) {
      const bal = await getBalance(payer.payerId).catch(() => null);
      const available = bal?.spendableBasePence ?? 0;
      if (available < price) return fail('insufficient_credit', { requiredPence: price, availablePence: Math.max(0, Math.round(available)) });
    }
    const walk = (await quoterFor(payer.payerId, false)).quote(price);
    if (walk.shortfallBasePence <= 0 && !faceMatches(input.quotedFacePence, walk.facePence)) return fail('price_changed', { pricePence: price });
  }

  // ── Claim: one pending report per account and listing ──
  const staleBefore = new Date(Date.now() - ANALYSIS_STALE_MS).toISOString();
  const { data: stale } = await admin.from('analysis_purchases').select('id, reservation_id').eq('user_id', payer.payerId).eq('canonical_url', l.canonicalUrl).eq('kind', 'btl_report').eq('status', 'pending').lt('created_at', staleBefore);
  for (const row of (stale ?? []) as { id: string; reservation_id: string | null }[]) {
    const { data: gone } = await admin.from('analysis_purchases').update({ status: 'failed', failure: 'abandoned', completed_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'pending').select('id');
    if ((gone ?? []).length > 0) await release(row.reservation_id);
  }
  const { data: claimed, error: claimErr } = await admin
    .from('analysis_purchases')
    .insert({ user_id: payer.payerId, buyer_id: input.userId, kind: 'btl_report', status: 'pending', deal_id: found.dealId, canonical_url: l.canonicalUrl, quoted_base_pence: price, analysis_base_pence: price, ready_at: now.toISOString(), run_started_at: now.toISOString(), ...(quote.offer ? { offer: quote.offer } : {}) })
    .select('id')
    .single();
  if (claimErr?.code === '23505') return /welcome_btl/.test(claimErr.message ?? '') ? fail('price_changed', { pricePence: quote.listPence }) : fail('running');
  if (claimErr || !claimed?.id) {
    console.error('[btl-report] claim failed:', claimErr?.message);
    return fail('failed');
  }
  const purchaseId = String(claimed.id);
  const finish = async (status: 'complete' | 'failed', extra: Record<string, unknown> = {}) => {
    const { error } = await admin.from('analysis_purchases').update({ status, completed_at: new Date().toISOString(), ...extra }).eq('id', purchaseId).eq('status', 'pending');
    if (error) console.error('[btl-report] purchase update failed:', error.message);
  };

  let reservationId: string | null = null;
  if (price > 0) {
    try {
      reservationId = await reserve(payer.payerId, 'btl_report', purchaseId, price, 5);
      if (reservationId) await admin.from('analysis_purchases').update({ reservation_id: reservationId }).eq('id', purchaseId);
    } catch (err) {
      if (err instanceof InsufficientCreditError && mustAfford) {
        await finish('failed', { failure: 'insufficient_credit' });
        return fail('insufficient_credit', { requiredPence: price, availablePence: Math.max(0, Math.round(err.availablePence)) });
      }
      console.warn('[btl-report] reservation not held:', (err as Error)?.message ?? err);
    }
  }
  const failNoCharge = async (code: BtlReportCode, why: string): Promise<BtlReportResult> => {
    await finish('failed', { failure: why });
    await release(reservationId);
    return fail(code);
  };

  try {
    // ── Run: the provider calls, metered against this purchase, never charged per call ──
    const kind = listingKind(l);
    const postcode = l.postcode;
    const bedrooms = l.bedrooms;
    const action = await startAction({ userId: input.userId, admin: input.adminUser, action: 'btl_report', actionId: purchaseId, fixedPrice: true });
    let bought: Awaited<ReturnType<typeof buy>>;
    async function buy() {
      const ctx = { mode: 'full' as const, userId: input.userId };
      const lat = typeof l.lat === 'number' ? l.lat : null;
      const lng = typeof l.lng === 'number' ? l.lng : null;
      const [rent, sale, sold, dd] = await Promise.all([
        ask(pdLongLetRent, { postcode, bedrooms, options: { propertyType: valuationPropertyType(l.rawType, kind) }, maxAttempts: 3 }, ctx),
        ask(pdSaleValuation, { postcode, bedrooms, propertyType: valuationPropertyType(l.rawType, kind) }, ctx),
        ask(pdSoldPrices, { postcode, type: pdSoldTypeFor(homeTypeOf(l.rawType)), maxAgeMonths: SOLD_MONTHS, from: lat !== null && lng !== null ? { lat, lng } : null }, ctx),
        l.address ? dueDiligenceFor(postcode, l.address, ctx) : Promise.resolve({ epc: null, dueDiligence: null }),
      ]);
      return { rent: rent.value, sale: sale.value, sold: sold.value, dd };
    }
    try {
      bought = await runMetered(action.ctx, buy);
    } finally {
      await action.finish();
    }

    // ── The figures, with the valuation and the EPC folded in ──
    const epcRating = bought.dd.epc?.rating?.toUpperCase() ?? null;
    const ctx = await btlContextFor(admin, l, now, { valuation: bought.rent ? { monthly: bought.rent.monthlyRent } : null, epc: isEpcRating(epcRating) ? epcRating : null });
    const screen = screenForBtl(l, ctx);
    if (screen.suitability !== 'ok') return await failNoCharge('unsuitable', `unsuitable: ${screen.suitability}`);
    if (!screen.card) return await failNoCharge('no_figures', 'no figures');

    // The member's own priority and benchmark: their active profile's answers.
    const { data: prof } = await admin.from('profiles').select('market_goals').eq('id', input.userId).maybeSingle();
    const goals = parseMarketGoals((prof as { market_goals?: unknown } | null)?.market_goals ?? null);
    const { data: areas } = await admin.from('saved_areas').select('postcode_area').eq('user_id', input.userId);
    const looker = btlLookerFor(goals, ((areas ?? []) as { postcode_area: string }[]).map((r) => r.postcode_area));
    const band = looker.cashBand ?? screen.card.band;
    const centre = looker.centre ?? (l.postcodeArea ? l.postcodeArea.toUpperCase() : null);
    const benchmark = centre && band ? await readBtlBenchmark(admin, centre, band) : null;
    const report: BtlReport = buildBtlReport({
      createdAt: now.toISOString(),
      dealId: found.dealId,
      title: reportTitle(bedrooms, kind, l.outcode ?? null),
      outcode: l.outcode ?? null,
      postcodeArea: l.postcodeArea ?? null,
      price: screen.card.price,
      card: screen.card,
      priority: goals?.btl?.priority ?? DEFAULT_BTL_PRIORITY,
      band,
      benchmark,
      regionName: centre ? regionPhrase(regionForArea(centre).name) : null,
      saleValuation: bought.sale ? { estimate: bought.sale.estimate, low: bought.sale.low, high: bought.sale.high, confidence: bought.sale.confidence ?? null } : null,
      sold: soldSummary(bought.sold, SOLD_MONTHS),
      rentValuation: bought.rent ? bought.rent.monthlyRent : null,
      dueDiligence: bought.dd.dueDiligence,
    });

    const { data: saved, error: saveErr } = await admin.from('btl_reports').insert({ user_id: input.userId, purchase_id: purchaseId, deal_id: found.dealId, canonical_url: l.canonicalUrl, result: report }).select('id').single();
    if (saveErr || !saved?.id) {
      console.error('[btl-report] save failed:', saveErr?.message);
      return await failNoCharge('failed', 'report write');
    }
    const reportId = String(saved.id);

    // ── Charge: only now that the report is written ──
    const { data: calls } = await admin.from('provider_calls').select('cost_pence').eq('action_id', purchaseId);
    const rawCost = ((calls ?? []) as { cost_pence: number | null }[]).reduce((sum, r) => sum + (Number(r.cost_pence) || 0), 0);
    let txId: number | null = null;
    const profileId = price > 0 && !payer.memberId ? await activeProfileIdOf(payer.payerId) : null;
    if (price > 0) {
      try {
        txId = await debit(payer.payerId, price, {
          reservationId,
          allowNegative: true,
          meta: { action: 'btl_report', action_id: purchaseId, provider: 'marketplace', unit: 'btl_report', quantity: 1, unit_cost_pence: 0, markup: 1, raw_cost_pence: rawCost, description: `Buy-to-let report: ${report.title}${quote.offer ? ' (welcome price)' : ''}`, ...(found.dealId ? { deal_id: found.dealId } : {}), ...(payer.memberId ? { member_id: payer.memberId } : {}), ...(profileId ? { profile_id: profileId } : {}) },
        });
      } catch (err) {
        console.error(`[btl-report] debit failed for purchase ${purchaseId}:`, err);
      }
    }
    await release(reservationId);
    if (txId !== null) void afterDebit(payer.payerId).catch(() => {});
    await finish('complete', { transaction_ids: txId === null ? [] : [txId], charged_base_pence: txId === null ? 0 : price });
    logActivity(input.userId, 'report_run', { ...(found.dealId ? { dealId: found.dealId } : {}), dedupeKey: `btl_report:${purchaseId}`, extras: { type: 'btl', from: found.dealId ? 'deal' : 'listing', ...(quote.offer ? { offer: quote.offer } : {}) } });
    return { ok: true, reportId, purchaseId, chargedBasePence: txId === null ? 0 : price };
  } catch (err) {
    console.error('[btl-report] failed:', err);
    return await failNoCharge('failed', (err as Error)?.message?.slice(0, 200) ?? 'threw');
  }
}

/** Sold prices nearby are read over this many months. */
const SOLD_MONTHS = 18;

/** A member's own report (theirs, or their team's), for its page; null when it is not theirs or not there. */
export async function btlReportFor(userId: string, reportId: string): Promise<{ report: BtlReport; createdAt: string; dealId: string | null } | null> {
  if (!hasServiceRole() || !/^[0-9a-f-]{36}$/i.test(reportId)) return null;
  const admin = createAdminClient();
  const payer = await payerFor(userId);
  const { data, error } = await admin.from('btl_reports').select('user_id, result, created_at, deal_id').eq('id', reportId).maybeSingle();
  if (error || !data) return null;
  const owner = (data as { user_id: string }).user_id;
  if (owner !== userId && (await payerFor(owner)).payerId !== payer.payerId) return null;
  const { parseBtlReport } = await import('./report');
  const report = parseBtlReport((data as { result: unknown }).result);
  return report ? { report, createdAt: String((data as { created_at: string }).created_at), dealId: (data as { deal_id: string | null }).deal_id } : null;
}

/**
 * The member's own reports by deal id or listing, latest first (deal id or url → report id). Null when unreadable,
 * so a caller that must not sell twice can tell "none" from "couldn't look".
 */
export async function reportIdsFor(admin: ReturnType<typeof createAdminClient>, userId: string, by: { dealIds?: readonly string[]; urls?: readonly string[] }): Promise<Map<string, string> | null> {
  const out = new Map<string, string>();
  const read = async (column: 'deal_id' | 'canonical_url', values: readonly string[]) => {
    if (values.length === 0) return true;
    const { data, error } = await admin.from('btl_reports').select(`id, ${column}`).eq('user_id', userId).in(column, [...values]).order('created_at', { ascending: false }).limit(500);
    if (error) return false;
    for (const r of (data ?? []) as unknown as Record<string, string | null>[]) {
      const k = r[column];
      if (k && !out.has(k)) out.set(k, String(r.id));
    }
    return true;
  };
  if (!(await read('deal_id', by.dealIds ?? [])) || !(await read('canonical_url', by.urls ?? []))) return null;
  return out;
}

/** The member's latest report on this deal (or listing), so the deal page links it instead of selling another. */
export async function latestBtlReportId(userId: string, target: BtlReportTarget): Promise<string | null> {
  if (!hasServiceRole()) return null;
  let q = createAdminClient().from('btl_reports').select('id').eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
  if (target.dealId) q = q.eq('deal_id', target.dealId);
  else if (target.url) q = q.eq('canonical_url', target.url);
  else return null;
  const { data, error } = await q;
  if (error) return null;
  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}
