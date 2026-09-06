import 'server-only';

import { getAreaCards } from '../market/cached';
import { fetchMarketTrends } from '../market/trends-client';
import { areaTrend } from '../market/trend';
import { ask, listingPerformance, nearbyListings, postcodeRevenue, strMarket, type BrokerContext } from '../broker';
import { matchTracked, rankCompetitors, summariseCompetitors, type TrackedListing } from './competitors';
import { purchaseDeal, rentToRentDeal, DEFAULT_FINANCE, type FinanceDefaults } from './deal';
import type { ListingKind } from './types';
import { postcodeAreaOf } from './normalise';
import type { QuickArea, QuickEstimate, QuickEstimateFigures } from './quick-types';

export interface QuickInput {
  kind: ListingKind;
  postcode?: string | null;
  outcode?: string | null;
  bedrooms: number;
  bathrooms?: number;
  lat?: number | null;
  lng?: number | null;
  airbnbId?: string | null;
  /** Asking price (sale) or advertised rent pcm (rent). */
  price?: number | null;
  finance?: Partial<FinanceDefaults> | null;
}

const TREND_LABEL: Record<string, string> = { up: 'Rising enquiries', flat: 'Steady', down: 'Falling enquiries', insufficient: 'Building history' };

async function areaSlice(code: string | null, bedrooms: number): Promise<QuickArea | null> {
  if (!code) return null;
  const [cards, trends] = await Promise.all([getAreaCards().catch(() => []), fetchMarketTrends().catch(() => null)]);
  const card = cards.find((c) => c.code === code);
  if (!card) return null;
  const t = trends ? areaTrend(trends.areas?.[code], { excludeLast: true }) : null;
  const bs = card.byBedrooms.find((b) => b.bedrooms === bedrooms) ?? null;
  return {
    code: card.code,
    slug: card.slug,
    name: card.name,
    score: card.score?.score ?? null,
    grade: card.score?.grade ?? null,
    gradeLabel: card.score?.gradeLabel ?? null,
    confidence: { tier: card.confidence.tier, label: card.confidence.label },
    competition: card.competition ? { label: card.competition.label, percentile: card.competition.percentile } : null,
    directBooking: card.directBooking ? { score: card.directBooking.score, label: card.directBooking.label } : null,
    licensing: { status: card.licensing.status, headline: card.licensing.headline },
    managedByStayful: card.managedByStayful,
    trend: t ? { direction: t.enquiries.direction, label: TREND_LABEL[t.enquiries.direction] ?? t.enquiries.direction } : null,
    bedroomStat: bs ? { bedrooms: bs.bedrooms, samples: bs.samples, grossRevenue: bs.grossRevenue, adr: bs.adr, occupancy: bs.occupancy } : null,
    headline: { grossRevenue: card.headline.grossRevenue, adr: card.headline.adr, occupancy: card.headline.occupancy, totalSamples: card.headline.totalSamples },
  };
}

/**
 * The free quick view: area context from the Market Explorer cache, any
 * figures we already hold for the postcode, tracked competitors within a
 * kilometre (one 5p call per 500 m cell per week), the pasted Airbnb
 * listing's own performance when a provider tracks it, and the deal maths
 * on the asking price or advertised rent. Never consumes a report run.
 */
export async function quickEstimate(input: QuickInput, ctx: BrokerContext): Promise<QuickEstimate> {
  const outcode = input.outcode ?? input.postcode?.split(' ')[0] ?? null;
  const areaCode = postcodeAreaOf(outcode);
  const hasPoint = typeof input.lat === 'number' && typeof input.lng === 'number';
  let limited = false;

  const [area, pcRes, nearbyRes] = await Promise.all([
    areaSlice(areaCode, input.bedrooms),
    input.postcode ? ask(postcodeRevenue, { postcode: input.postcode, bedrooms: input.bedrooms }, ctx) : Promise.resolve(null),
    hasPoint ? ask(nearbyListings, { lat: input.lat!, lng: input.lng! }, ctx) : Promise.resolve(null),
  ]);

  const nearby: TrackedListing[] | null = nearbyRes?.value ?? null;
  if (nearbyRes && nearbyRes.unavailable && hasPoint) limited = true;

  let tracked: QuickEstimate['tracked'] = null;
  let trackedMissing = false;
  if (input.airbnbId) {
    const hit = nearby ? matchTracked(nearby, input.airbnbId) : null;
    if (hit) tracked = { ...hit, provider: nearbyRes?.provider ?? 'airbtics', updatedAt: nearbyRes?.updatedAt ?? null };
    else {
      const perf = await ask(listingPerformance, { listingId: input.airbnbId, lat: input.lat ?? undefined, lng: input.lng ?? undefined }, ctx);
      if (perf.value) tracked = { ...perf.value, provider: perf.provider ?? 'internal', updatedAt: perf.updatedAt };
      else trackedMissing = true;
      if (perf.unavailable && !perf.value) limited = true;
    }
  }

  const competitors = nearby
    ? { summary: summariseCompetitors(nearby, input.bedrooms), top: rankCompetitors(nearby, 8), cell: nearbyRes!.cached ? 'cached' : 'live', updatedAt: nearbyRes!.updatedAt, stale: nearbyRes!.stale }
    : null;

  // Pick the estimate, best evidence first.
  let estimate: QuickEstimateFigures | null = null;
  const pc = pcRes?.value ?? null;
  if (pc && pc.grossRevenue) {
    estimate = { grossRevenue: pc.grossRevenue, adr: pc.adr, occupancy: pc.occupancy, source: 'postcode-reports', note: `Average of ${pc.samples} recent Stayful report${pc.samples === 1 ? '' : 's'} for this postcode and size`, updatedAt: pc.latestAt, stale: false };
  } else if (competitors && competitors.summary.sameSize >= 3 && competitors.summary.medianRevenue) {
    const same = nearby!.filter((l) => l.bedrooms === input.bedrooms && l.annualRevenue > 0);
    const s = summariseCompetitors(same);
    estimate = { grossRevenue: s.medianRevenue ?? competitors.summary.medianRevenue, adr: s.medianAdr, occupancy: s.medianOccupancy === null ? null : Math.round(s.medianOccupancy * 1000) / 10, source: 'competitors', note: `Median of ${same.length} tracked ${input.bedrooms}-bed Airbnbs within 1 km`, updatedAt: competitors.updatedAt, stale: competitors.stale };
  } else if (area?.bedroomStat?.grossRevenue) {
    estimate = { grossRevenue: area.bedroomStat.grossRevenue, adr: area.bedroomStat.adr, occupancy: area.bedroomStat.occupancy, source: 'area-bedrooms', note: `${area.name} average for ${input.bedrooms}-bed properties (${area.bedroomStat.samples} reports)`, updatedAt: null, stale: false };
  } else if (area?.headline.grossRevenue) {
    estimate = { grossRevenue: area.headline.grossRevenue, adr: area.headline.adr, occupancy: area.headline.occupancy, source: 'area', note: `${area.name} average across all sizes (${area.headline.totalSamples} reports)`, updatedAt: null, stale: false };
  }

  // Last resort: PMI's area snapshot for the outcode (3 credits, cached a week).
  let pmiMarket: QuickEstimate['pmiMarket'] = null;
  if (!estimate && outcode) {
    const m = await ask(strMarket, { outcode, bedrooms: input.bedrooms }, ctx);
    if (m.value) {
      const bb = m.value.byBedrooms.find((b) => b.bedrooms === input.bedrooms);
      pmiMarket = { adr: m.value.adr, occupancy: m.value.occupancy, revenueAnnual: m.value.revenueAnnual, activeListings: m.value.activeListings, supplyGrowthPct: m.value.supplyGrowthPct, grade: m.value.grade, updatedAt: m.updatedAt };
      const rev = bb?.revenueAnnual ?? m.value.revenueAnnual;
      if (rev) estimate = { grossRevenue: rev, adr: bb?.adr ?? m.value.adr, occupancy: bb?.occupancy ?? m.value.occupancy, source: 'pmi-market', note: `Property Market Intel area average for ${outcode}${bb ? ` (${input.bedrooms}-bed)` : ''}`, updatedAt: m.updatedAt, stale: m.stale };
    } else if (m.unavailable) limited = true;
  }

  let deal: QuickEstimate['deal'] = null;
  if (estimate && input.price && input.price > 0) {
    const base = { grossRevenue: estimate.grossRevenue, adr: estimate.adr ?? 0, bedrooms: input.bedrooms, finance: { ...DEFAULT_FINANCE, ...(input.finance ?? {}) } };
    if (input.kind === 'sale') deal = purchaseDeal(input.price, base);
    if (input.kind === 'rent') deal = rentToRentDeal(input.price, base);
  }

  return { area, estimate, competitors, tracked, trackedMissing, pmiMarket, deal, limited };
}
