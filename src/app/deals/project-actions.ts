'use server';

/**
 * A member's own working on a Project deal (Batch 17, Part G): save a
 * version, lock one, unlock it. Called from the working editor on the deal
 * sheet, so they answer rather than redirect. Only for a member whose
 * account has opened the deal; everything is re-checked and worked out
 * again here, never taken from the browser. Free: nothing is charged.
 */
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';
import { payerFor } from '@/lib/team';
import { dealVisibilityFor } from '@/lib/marketplace/tier';
import { dealSheet } from '@/lib/marketplace/open';
import { projectEstimateFor } from '@/lib/project/read-server';
import { readProjectSettings } from '@/lib/project/settings-server';
import { cleanMemberLines, evaluateMember, memberContextFrom, memberFiguresFrom, type MemberFigures } from '@/lib/project/member-figures';
import { saveMemberWorking, unlockMemberWorking } from '@/lib/project/member-figures-server';
import { logActivity } from '@/lib/activity/log';

const UUID = /^[0-9a-f-]{36}$/i;

export type WorkingResult =
  | { ok: true; version: number | null; locked: boolean; figures: MemberFigures | null }
  | { ok: false; error: 'signed_out' | 'not_open' | 'no_estimate' | 'bad_lines' | 'failed' };

/** The signed-in member who may work on this deal (their account opened it), with its estimate. */
async function access(dealId: unknown) {
  if (typeof dealId !== 'string' || !UUID.test(dealId) || !hasServiceRole()) return { error: 'not_open' as const };
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'signed_out' as const };
  const adminUser = isAdminEmail(user.email);
  const { payerId } = await payerFor(user.id);
  const sheet = await dealSheet(dealId, payerId, adminUser, await dealVisibilityFor(user.id, adminUser));
  if (!sheet?.priv) return { error: 'not_open' as const };
  const admin = createAdminClient();
  const stored = await projectEstimateFor(admin, dealId);
  // A Project deal always has its bedrooms (the check needs them); without them there is nothing to work on.
  if (!stored || sheet.deal.bedrooms === null) return { error: 'no_estimate' as const };
  return { user, admin, stored, bedrooms: sheet.deal.bedrooms };
}

/** Saves the member's lines as a new version, locked when `lock` is true. */
export async function saveProjectWorkingAction(dealId: unknown, lines: unknown, lock: unknown): Promise<WorkingResult> {
  try {
    const a = await access(dealId);
    if ('error' in a) return { ok: false, error: a.error ?? 'failed' };
    const cleaned = cleanMemberLines(lines, a.stored.estimate.lines);
    if (!cleaned.ok) return { ok: false, error: 'bad_lines' };
    const settings = await readProjectSettings(a.admin);
    const figures = memberFiguresFrom(evaluateMember(cleaned.lines, memberContextFrom(a.stored.estimate, a.bedrooms, settings, settings.bridging)), a.stored.estimate.lines);
    const locking = lock === true;
    const saved = await saveMemberWorking(a.admin, { userId: a.user.id, dealId: dealId as string, lines: cleaned.lines, figures, lock: locking });
    if (!saved.ok) return { ok: false, error: 'failed' };
    if (locking) logActivity(a.user.id, 'project_lock', { dealId: dealId as string, dedupeKey: `project_lock:${dealId}:${saved.version}`, extras: { version: saved.version } });
    return { ok: true, version: saved.version, locked: locking, figures };
  } catch (err) {
    console.error('[project] save failed:', (err as Error)?.message ?? err);
    return { ok: false, error: 'failed' };
  }
}

/** Unlocks the member's locked figures (the versions stay). */
export async function unlockProjectWorkingAction(dealId: unknown): Promise<WorkingResult> {
  try {
    const a = await access(dealId);
    if ('error' in a) return { ok: false, error: a.error ?? 'failed' };
    const version = await unlockMemberWorking(a.admin, a.user.id, dealId as string);
    if (version !== null) logActivity(a.user.id, 'project_unlock', { dealId: dealId as string, dedupeKey: `project_unlock:${dealId}:${version}`, extras: { version } });
    return { ok: true, version, locked: false, figures: null };
  } catch (err) {
    console.error('[project] unlock failed:', (err as Error)?.message ?? err);
    return { ok: false, error: 'failed' };
  }
}
