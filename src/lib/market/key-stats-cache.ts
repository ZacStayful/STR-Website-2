import 'server-only';

import { ask, pdRegionKeyStats } from '../broker';
import type { KeyStatsRow } from '../apis/propertydata-parse';
import { PD_REGIONS, warmRegionKeyStats, type KeyStatsReader, type PdRegion, type WarmResult } from './key-stats';

/**
 * The region key stats as the explorer and the report read them: from the
 * broker cache only, fresh or stale, never buying. Buying is the cron's
 * job (`warmAllRegionKeyStats`), so a member's request is never charged
 * thirty credits for a region.
 */

export interface RegionKeyStats {
  region: PdRegion;
  rows: KeyStatsRow[];
  asOf: string | null;
  stale: boolean;
}

export async function readRegionKeyStats(region: PdRegion): Promise<RegionKeyStats | null> {
  const r = await ask(pdRegionKeyStats, { region }, { mode: 'cron', cacheOnly: true });
  return r.value ? { region, rows: r.value, asOf: r.updatedAt, stale: r.stale } : null;
}

/** Every region in the cache, keyed by region; regions never bought are absent. */
export async function readAllRegionKeyStats(): Promise<Map<PdRegion, RegionKeyStats>> {
  const all = await Promise.all(PD_REGIONS.map((region) => readRegionKeyStats(region)));
  const out = new Map<PdRegion, RegionKeyStats>();
  for (const s of all) if (s) out.set(s.region, s);
  return out;
}

const reader: KeyStatsReader = async (region, mode) => {
  const r = await ask(pdRegionKeyStats, { region }, mode === 'cache' ? { mode: 'cron', cacheOnly: true } : { mode: 'cron' });
  return { value: r.value, cached: r.cached, stale: r.stale, unavailable: r.unavailable, updatedAt: r.updatedAt };
};

/** The daily warm-up: house spend, a few regions a run. */
export function warmAllRegionKeyStats(max?: number): Promise<WarmResult> {
  return warmRegionKeyStats(reader, max);
}
