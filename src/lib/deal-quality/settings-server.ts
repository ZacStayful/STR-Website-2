import 'server-only';

import type { createAdminClient } from '../supabase/admin';
import { DEAL_CHECKS_KEY, DEAL_COMPS_KEY, DEAL_CONFIDENCE_KEY, parseDealChecks, parseDealComps, parseDealConfidence, type DealChecksSettings, type DealCompsSettings, type DealConfidenceSettings } from './config';

type Admin = ReturnType<typeof createAdminClient>;

export interface DealQualitySettings {
  comps: DealCompsSettings;
  confidence: DealConfidenceSettings;
  checks: DealChecksSettings;
}

/** Batch 16's settings from billing_settings; a missing row, or one that cannot be read, takes the decided defaults. */
export async function readDealQualitySettings(admin: Admin): Promise<DealQualitySettings> {
  const { data, error } = await admin.from('billing_settings').select('key, value').in('key', [DEAL_COMPS_KEY, DEAL_CONFIDENCE_KEY, DEAL_CHECKS_KEY]);
  if (error) console.warn('[deal-quality] settings unreadable, using the defaults:', error.message);
  const rows = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  return {
    comps: parseDealComps(rows.get(DEAL_COMPS_KEY)),
    confidence: parseDealConfidence(rows.get(DEAL_CONFIDENCE_KEY)),
    checks: parseDealChecks(rows.get(DEAL_CHECKS_KEY)),
  };
}
