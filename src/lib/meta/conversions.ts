import 'server-only';

/**
 * Conversions on the server (Batch 19): who never counts, and the browser's
 * share of each conversion (the pixel fires the same event with the same id,
 * so Meta keeps one).
 *
 *   metaExclusion      admin, staff, switched off (Batch 9's "Exclude") or a
 *                      team seat: never any Meta event for them
 *   pendingForBrowser  the member's conversions the browser may still fire:
 *                      recorded (or released) with consent, from production,
 *                      under a day old, not fired yet
 *   claimForBrowser    one of them, claimed atomically: two tabs, a reload or
 *                      a double tap never fire it twice
 *
 * Nothing here throws.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { adminEmails } from '../admin';
import { emailKey } from '../supabase/email-key';
import { exclusionFor } from '../activity/metrics';
import { isTeamBound } from '../team';
import { TRACKING } from '../tracking/config';
import { parseBrowserConversion, type BrowserConversion } from '../tracking/me';

export type MetaExclusion = 'admin' | 'staff' | 'manual' | 'team' | 'unknown';

function warn(message: string): void {
  console.warn('[meta]', message);
}

/**
 * Why this account never sends Meta anything, or null when it may. When the
 * check itself fails, the answer is 'unknown': nothing is sent.
 */
export async function metaExclusion(userId: string, email: string | null): Promise<MetaExclusion | null> {
  const quick = exclusionFor(email, undefined, new Set(adminEmails().map(emailKey)));
  if (quick) return quick;
  if (!hasServiceRole()) return 'unknown';
  try {
    const { data, error } = await createAdminClient().from('activity_excluded_accounts').select('user_id').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return 'manual';
    return (await isTeamBound(userId, email)) ? 'team' : null;
  } catch (err) {
    warn(`exclusion not checked: ${err instanceof Error ? err.message : String(err)}`);
    return 'unknown';
  }
}

const BROWSER_COLUMNS = 'dedupe_key, event_id, event_name, value_pence';

type BrowserRow = { dedupe_key: string; event_id: string; event_name: string; value_pence: number | null };

function toBrowser(r: BrowserRow): BrowserConversion | null {
  return parseBrowserConversion({ key: r.dedupe_key, name: r.event_name, eventId: r.event_id, valuePence: r.value_pence });
}

/** A day back: older conversions are no longer fired from the browser (Meta only matches the two copies within 48 hours). */
function browserSince(now: Date): string {
  return new Date(now.getTime() - TRACKING.browserWindowHours * 3_600_000).toISOString();
}

export async function pendingForBrowser(userId: string, now: Date = new Date()): Promise<BrowserConversion[]> {
  if (!hasServiceRole()) return [];
  try {
    const since = browserSince(now);
    const { data, error } = await createAdminClient()
      .from('meta_conversions')
      .select(BROWSER_COLUMNS)
      .eq('user_id', userId)
      .eq('env', 'production')
      .eq('consented', true)
      .is('browser_claimed_at', null)
      .or(`created_at.gt.${since},released_at.gt.${since}`)
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) throw new Error(error.message);
    return ((data ?? []) as BrowserRow[]).map(toBrowser).filter((c): c is BrowserConversion => c !== null);
  } catch (err) {
    warn(`pending conversions not read: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Claim one conversion for the browser: only the first claim gets it back
 * (the update only matches while nobody has claimed it).
 */
export async function claimForBrowser(userId: string, key: string, now: Date = new Date()): Promise<BrowserConversion | null> {
  if (!hasServiceRole() || !key || key.length > 200) return null;
  try {
    const { data, error } = await createAdminClient()
      .from('meta_conversions')
      .update({ browser_claimed_at: now.toISOString() })
      .eq('dedupe_key', key)
      .eq('user_id', userId)
      .eq('env', 'production')
      .eq('consented', true)
      .is('browser_claimed_at', null)
      .or(`created_at.gt.${browserSince(now)},released_at.gt.${browserSince(now)}`)
      .select(BROWSER_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toBrowser(data as BrowserRow) : null;
  } catch (err) {
    warn(`conversion not claimed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
