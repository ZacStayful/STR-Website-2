import 'server-only';

/**
 * Batch 28's settings, read once per request or run: the btl_* rows, the
 * shortlist's line in Batch 16's deal_checks row, and Batch 17's buying
 * costs (project_costs.buyingCosts, the one £2,500). A missing or unreadable
 * row reads as its decided default (config.ts), never as "off".
 */
import type { createAdminClient } from '../supabase/admin';
import { BTL_SETTING_KEYS, DEFAULT_BTL_SETTINGS, parseBtlSettings, type BtlSettings } from './config';
import { DEFAULT_PROJECT_COSTS, PROJECT_COSTS_KEY, parseProjectCosts } from '../project/config';
import { DEAL_CHECKS_KEY } from '../deal-quality/config';

type Admin = ReturnType<typeof createAdminClient>;

export interface BtlSettingsRead {
  settings: BtlSettings;
  /** Batch 17's buying costs, £. */
  buyingCosts: number;
}

export async function readBtlSettings(admin: Admin): Promise<BtlSettingsRead> {
  const { data, error } = await admin.from('billing_settings').select('key, value').in('key', [...BTL_SETTING_KEYS, DEAL_CHECKS_KEY, PROJECT_COSTS_KEY]);
  if (error) {
    console.warn('[btl] settings unreadable, using the defaults:', error.message);
    return { settings: DEFAULT_BTL_SETTINGS, buyingCosts: DEFAULT_PROJECT_COSTS.buyingCosts };
  }
  const rows: Record<string, unknown> = {};
  for (const r of (data ?? []) as { key: string; value: unknown }[]) rows[r.key] = r.value;
  return { settings: parseBtlSettings(rows, rows[DEAL_CHECKS_KEY]), buyingCosts: parseProjectCosts(rows[PROJECT_COSTS_KEY]).buyingCosts };
}

/** The nightly screen's switch (env), the same pattern as DEAL_CHECKS_ENABLED. A dry run works either way. */
export function btlScreenEnabled(): boolean {
  return process.env.BTL_SCREEN_ENABLED === 'true';
}
