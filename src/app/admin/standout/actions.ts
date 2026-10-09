'use server';

import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';
import { updateBillingSetting } from '@/lib/credit/unit-costs';
import { runStandout } from '@/lib/standout/run';
import { memberIdByEmail } from '@/lib/standout/admin-server';
import { parseStandout, STANDOUT_KEYS, type StandoutSettings } from '@/lib/standout/settings';

// Mirrored in page.tsx: a 'use server' module may only export async functions.
const FLASH_COOKIE = 'sf_standout_flash';

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/admin/standout');
  if (!isAdminEmail(user.email)) notFound();
  return user;
}

async function flash(kind: string, body: Record<string, unknown>): Promise<never> {
  const jar = await cookies();
  const compact = Object.fromEntries(Object.entries(body).filter(([, v]) => v === null || typeof v !== 'object'));
  const value = Buffer.from(JSON.stringify({ kind, at: new Date().toISOString(), body: compact })).toString('base64url').slice(0, 3800);
  jar.set(FLASH_COOKIE, value, { maxAge: 300, path: '/admin/standout', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  redirect('/admin/standout');
}

/** One real pass now. Off (STANDOUT_ENABLED unset): it reports and writes nothing, like a dry run. */
export async function runStandoutPassAction(): Promise<void> {
  await requireAdmin();
  const r = await runStandout({ apply: true, kind: 'admin' });
  await flash('pass', { enabled: r.enabled, deals: r.deals, members: r.members, judged: r.judged, standouts: r.standouts, saved: r.saved, waiting: r.waiting, rechecked: r.rechecked, errors: r.errors.join('; ') || null });
}

/**
 * The test helper: save one deal for one member as a standout, skipping
 * only the thresholds (match, checks, profit, reveal, best so far, one a
 * day). Everything else still applies: the member's primary profile and its
 * deal types, must-haves, the free delay, "new to them", the live check —
 * and every rule of the call (consent, hours, one a day, the monthly limit,
 * the credit floor).
 */
export async function forceStandoutAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const email = String(formData.get('email') ?? '').trim();
  const dealId = String(formData.get('deal') ?? '').trim();
  if (!email || !/^[0-9a-f-]{36}$/i.test(dealId)) return flash('force', { error: 'Give a member email and a deal id.' });
  const userId = await memberIdByEmail(createAdminClient(), email);
  if (!userId) return flash('force', { error: 'No member with that email.' });
  const r = await runStandout({ apply: true, kind: 'admin', force: { userId, dealId } });
  const d = r.decisions.find((x) => x.dealId === dealId);
  await flash('force', { saved: r.saved, outcome: d?.outcome ?? (r.deals === 0 ? 'not live' : 'not judged'), reason: d?.reasonText ?? (r.deals === 0 ? 'The deal is not live (or does not exist).' : 'The member is not visible to this deal yet (free delay) or was skipped.'), notified: r.notifications?.results.find((x) => x.dealId === dealId)?.outcome ?? null, errors: r.errors.join('; ') || null });
}

export async function updateStandoutSettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const raw = (k: keyof StandoutSettings) => {
    const v = formData.get(k);
    return typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined;
  };
  // Parsed the way the reader parses: anything out of range is refused rather than saved.
  const asked = Object.fromEntries((Object.keys(STANDOUT_KEYS) as (keyof StandoutSettings)[]).map((k) => [k, raw(k)]));
  const parsed = parseStandout((key) => {
    const field = (Object.entries(STANDOUT_KEYS) as [keyof StandoutSettings, string][]).find(([, v]) => v === key)?.[0];
    return field ? asked[field] : undefined;
  });
  const bad = (Object.keys(asked) as (keyof StandoutSettings)[]).filter((k) => asked[k] !== undefined && asked[k] !== parsed[k]);
  if (bad.length > 0) return flash('settings', { error: `Not saved: out of range — ${bad.join(', ')}` });
  try {
    for (const k of Object.keys(asked) as (keyof StandoutSettings)[]) if (asked[k] !== undefined) await updateBillingSetting(STANDOUT_KEYS[k], asked[k]);
  } catch (err) {
    return flash('settings', { error: `Not saved: ${(err as Error)?.message ?? 'the settings could not be written'}` });
  }
  revalidatePath('/admin/standout');
  return flash('settings', { saved: true });
}
