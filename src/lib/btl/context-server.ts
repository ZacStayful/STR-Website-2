import 'server-only';

/**
 * Batch 28: the buy-to-let screen's context for ONE listing (the £2 report,
 * the analyser's "Buy to let instead?"): the settings, the district's key
 * stats, the live rentals in its postcode area, and the cached live rate.
 * Everything here is free: cache reads only, never a provider call (the
 * report buys its own valuation and EPC, and hands them in).
 */
import type { createAdminClient } from '../supabase/admin';
import { ask, pdMortgageRates } from '../broker';
import { liveMortgageRate } from '../listing/mortgage-rate';
import { readRegionKeyStats } from '../market/key-stats-cache';
import { pdRegionForOutcode } from '../market/key-stats';
import type { EpcRating } from './deal';
import { rentCompFrom, type BtlScreenContext, type DistrictStats, type RentalRow, type Valuation } from './screen';
import type { RentComp } from './rent';
import { readBtlSettingsCached } from './settings-server';

type Admin = ReturnType<typeof createAdminClient>;

const DAY_MS = 86_400_000;
const RENTALS_MAX = 2_000;

/** The district's key stats for this outcode; null when its region was never bought or the outcode is not in it. */
export async function districtFor(outcode: string | null): Promise<DistrictStats | null> {
  const code = (outcode ?? '').replace(/\s+/g, '').toUpperCase();
  const region = code ? pdRegionForOutcode(code) : null;
  if (!region) return null;
  const stats = await readRegionKeyStats(region).catch(() => null);
  const row = stats?.rows.find((r) => r.outcode?.toUpperCase() === code) ?? null;
  return row && stats ? { row, region, asOf: stats.asOf } : null;
}

/** Live rentals in one postcode area, seen within the comparables' age. */
export async function rentalsFor(admin: Admin, postcodeArea: string | null, maxAgeDays: number, now: Date): Promise<RentComp[]> {
  const area = (postcodeArea ?? '').toUpperCase();
  if (!area) return [];
  const { data, error } = await admin
    .from('sourced_listings')
    .select('postcode_area, price:snapshot->price, bedrooms:snapshot->bedrooms, lat:snapshot->lat, lng:snapshot->lng, raw_type:snapshot->>rawType, title:snapshot->>title')
    .eq('kind', 'rent')
    .eq('postcode_area', area)
    .gte('last_seen_at', new Date(now.getTime() - maxAgeDays * DAY_MS).toISOString())
    .limit(RENTALS_MAX);
  if (error) {
    console.warn('[btl] rentals unreadable:', error.message);
    return [];
  }
  return ((data ?? []) as unknown as RentalRow[]).map(rentCompFrom).filter((c): c is RentComp => c !== null);
}

/** The context screenForBtl reads, for one listing, with a paid valuation and EPC when the caller has them. */
export async function btlContextFor(admin: Admin, listing: { canonicalUrl: string; outcode: string | null; postcodeArea: string | null }, now: Date, extras: { valuation?: Valuation | null; epc?: EpcRating | null } = {}): Promise<BtlScreenContext> {
  const { settings, buyingCosts } = await readBtlSettingsCached(admin);
  const [district, rentals, rates] = await Promise.all([districtFor(listing.outcode), rentalsFor(admin, listing.postcodeArea, settings.rent.compsMaxAgeDays, now), ask(pdMortgageRates, {}, { mode: 'cron', cacheOnly: true })]);
  const live = liveMortgageRate(rates.value);
  return {
    settings,
    buyingCosts,
    ratePct: live?.ratePct ?? null,
    rateDate: live?.date ?? null,
    district: () => district,
    rentals: () => rentals,
    epc: () => extras.epc ?? null,
    valuation: () => extras.valuation ?? null,
    now,
  };
}
