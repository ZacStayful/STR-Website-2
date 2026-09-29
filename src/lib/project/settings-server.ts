import 'server-only';

/**
 * Batch 17's settings from billing_settings: the project rows (config.ts),
 * the photo-check allowance inside Batch 16's deal_checks row, the bridging
 * terms Batch 16 set for auction lots (one set of terms, not a second), and
 * Today's mix (today/mix.ts). A read that fails is the decided defaults, never
 * an error: a page or a job never stops over a settings row.
 *
 * The Today mix is read once a minute at most: the morning run chooses a list
 * for every profile, and the row changes by hand.
 */
import type { createAdminClient } from '../supabase/admin';
import { AUCTION_MODEL_KEY, parseAuctionTerms, type AuctionTerms } from '../deal-quality/auction';
import { DEAL_CHECKS_KEY } from '../deal-quality/config';
import { PROJECT_CEILING_KEY, PROJECT_CHECKS_KEY, PROJECT_COSTS_KEY, PROJECT_QUANTITIES_KEY, PROJECT_RATES_KEY, PROJECT_VALUE_KEY, parseProjectSettings, type ProjectSettings } from './config';
import { DEFAULT_TODAY_MIX, parseTodayMix, TODAY_MIX_KEY, type TodayMixSettings } from '../today/mix';

type Admin = ReturnType<typeof createAdminClient>;

const PROJECT_KEYS = [PROJECT_RATES_KEY, PROJECT_QUANTITIES_KEY, PROJECT_VALUE_KEY, PROJECT_CEILING_KEY, PROJECT_COSTS_KEY, PROJECT_CHECKS_KEY, DEAL_CHECKS_KEY, AUCTION_MODEL_KEY];

export interface ProjectSettingsRead extends ProjectSettings {
  /** Batch 16's bridging terms (auction_model). */
  bridging: AuctionTerms;
}

export async function readProjectSettings(admin: Admin): Promise<ProjectSettingsRead> {
  const { data, error } = await admin.from('billing_settings').select('key, value').in('key', PROJECT_KEYS);
  if (error) console.warn('[project] settings unreadable, using the defaults:', error.message);
  const rows: Record<string, unknown> = {};
  for (const r of (data ?? []) as { key: string; value: unknown }[]) rows[r.key] = r.value;
  return { ...parseProjectSettings(rows, rows[DEAL_CHECKS_KEY]), bridging: parseAuctionTerms(rows[AUCTION_MODEL_KEY]) };
}

let mixCache: { at: number; value: TodayMixSettings } | null = null;
const MIX_TTL_MS = 60_000;

export async function readTodayMix(admin: Admin): Promise<TodayMixSettings> {
  if (mixCache && Date.now() - mixCache.at < MIX_TTL_MS) return mixCache.value;
  const { data, error } = await admin.from('billing_settings').select('value').eq('key', TODAY_MIX_KEY).maybeSingle();
  if (error) {
    console.warn('[today] mix setting unreadable, using the default:', error.message);
    return DEFAULT_TODAY_MIX;
  }
  const value = parseTodayMix((data as { value?: unknown } | null)?.value ?? null);
  mixCache = { at: Date.now(), value };
  return value;
}
