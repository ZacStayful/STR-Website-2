import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { updateBillingSetting } from '../credit/unit-costs';
import { adminEmails } from '../admin';
import { CACHE_MS, SETTING_KEYS, type FeedbackSettings } from './config';
import { parseSettings } from './rules';

/**
 * Batch 18's settings (billing_settings, see src/lib/feedback/config.ts),
 * read in one query and kept for a minute, like the credit settings. A
 * missing or unreadable row takes its default; an admin address that is not
 * a single valid address falls back to the first of ADMIN_EMAILS, so reports
 * are never emailed nowhere.
 */
let cache: { at: number; settings: FeedbackSettings } | null = null;

export async function feedbackSettings(): Promise<FeedbackSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.settings;
  const fallback = adminEmails()[0] ?? null;
  if (!hasServiceRole()) return parseSettings(new Map(), fallback);
  const { data, error } = await createAdminClient().from('billing_settings').select('key, value').in('key', Object.values(SETTING_KEYS));
  if (error) console.warn('[feedback] settings unreadable, using the defaults:', error.message);
  const settings = parseSettings(new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [String(r.key), r.value])), fallback);
  if (!error) cache = { at: Date.now(), settings };
  return settings;
}

/**
 * Saves the settings admin changed, each already checked by parseSettings,
 * and forgets this server's copy. Other servers pick the change up within
 * a minute.
 */
export async function saveFeedbackSettings(next: Partial<FeedbackSettings>): Promise<void> {
  const writes: [string, unknown][] = [];
  if (next.dailyLimit !== undefined) writes.push([SETTING_KEYS.dailyLimit, next.dailyLimit]);
  if (next.maxScreenshots !== undefined) writes.push([SETTING_KEYS.maxScreenshots, next.maxScreenshots]);
  if (next.screenshotMaxMb !== undefined) writes.push([SETTING_KEYS.screenshotMaxMb, next.screenshotMaxMb]);
  if (next.retentionDays !== undefined) writes.push([SETTING_KEYS.retentionDays, next.retentionDays]);
  if (next.adminEmail !== undefined) writes.push([SETTING_KEYS.adminEmail, next.adminEmail]);
  if (next.announcementMaxAgeDays !== undefined) writes.push([SETTING_KEYS.announcementMaxAgeDays, next.announcementMaxAgeDays]);
  try {
    for (const [key, value] of writes) await updateBillingSetting(key, value);
  } finally {
    cache = null;
  }
}
