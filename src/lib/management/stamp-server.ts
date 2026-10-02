import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { recordActivity } from '../activity/log';
import { recordConversion } from '../meta/conversions';
import { queueFunnelSync } from '../crm/monday-funnel/queue-server';
import { isManagement, managementOnly, type StampVia } from './stamp';

/**
 * Batch 22f: setting and reading the management-company stamp
 * (profiles.signup_path; see ./stamp.ts for what it changes).
 */

/** The three mandatory profile questions are answered (deal-finding is on). */
async function mandatoryDoneFor(userId: string): Promise<boolean> {
  try {
    const { profileSummaryFor } = await import('../profile/server');
    const s = await profileSummaryFor(userId);
    return Boolean(s?.progress.mandatoryDone);
  } catch (err) {
    console.error('[management] profile read failed:', err);
    return false;
  }
}

/**
 * Stamps an account as a management company, once (an existing stamp is left
 * alone, so the first way in is the one recorded). On the stamping write:
 * daily picks are written OFF unless deal-finding is already on (a member
 * who answered the questions chose picks already); mc_signup is recorded
 * (activity and the Meta event). Awaited: callers run it after the response
 * or in an action. Never throws; returns whether this call set the stamp.
 */
export async function stampManagement(userId: string, via: StampVia): Promise<boolean> {
  if (!hasServiceRole() || !userId) return false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('profiles')
      .update({ signup_path: 'management', signup_path_at: new Date().toISOString(), signup_path_via: via })
      .eq('id', userId)
      .is('signup_path', null)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return false;

    // Written explicitly: a missing value reads as on (notificationState). Not
    // an opt-out (no sourcing_opted_out_at): picks are offered, unticked, when
    // they switch deal-finding on.
    if (!(await mandatoryDoneFor(userId))) {
      const { error: picksErr } = await admin.from('profiles').update({ sourcing_alerts: false }).eq('id', userId);
      if (picksErr) console.error('[management] picks off failed:', picksErr.message);
      else await queueFunnelSync(userId, 'notifications').catch(() => {});
    }
    await recordActivity(userId, 'mc_signup', { dedupeKey: 'mc_signup', extras: { via } });
    await recordConversion({ name: 'mc_signup', userId });
    return true;
  } catch (err) {
    console.error('[management] stamp failed:', err);
    return false;
  }
}

/** The stamp, or null. A read failure (or a schema behind) reads as not stamped: the usual rules apply. */
export async function signupPathOf(userId: string): Promise<string | null> {
  if (!hasServiceRole() || !userId) return null;
  try {
    const { data, error } = await createAdminClient().from('profiles').select('signup_path').eq('id', userId).maybeSingle();
    if (error) return null;
    const v = (data as { signup_path?: string | null } | null)?.signup_path;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export async function isManagementAccount(userId: string): Promise<boolean> {
  return isManagement(await signupPathOf(userId));
}

/**
 * Stamped and deal-finding not yet on: lands on Leads, skips the quiz and the
 * reveal. Only reads the profile when the account is stamped.
 */
export async function isManagementOnly(userId: string): Promise<boolean> {
  const path = await signupPathOf(userId);
  if (!isManagement(path)) return false;
  return managementOnly({ signupPath: path, mandatoryDone: await mandatoryDoneFor(userId) });
}
