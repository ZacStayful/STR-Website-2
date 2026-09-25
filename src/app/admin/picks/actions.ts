'use server';

import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { runDailyPicks } from '@/lib/listing/picks-run';
import { runPausedEmails } from '@/lib/listing/picks-paused-run';
import { runDailyNotice } from '@/lib/listing/daily-notice-run';

// Mirrored in page.tsx: a 'use server' module may only export async functions.
const RUN_COOKIE = 'sf_picks_run';

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/admin/picks');
  if (!isAdminEmail(user.email)) notFound();
  return user;
}

/** Stashes the run summary for the page to render once, then goes back to it. */
async function finish(kind: 'test' | 'dry' | 'paused-dry' | 'notice-dry' | 'notice', body: Record<string, unknown>): Promise<never> {
  const jar = await cookies();
  const value = Buffer.from(JSON.stringify({ kind, at: new Date().toISOString(), body })).toString('base64url').slice(0, 3800);
  jar.set(RUN_COOKIE, value, { maxAge: 300, path: '/admin/picks', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  redirect('/admin/picks');
}

/**
 * A real pick, to the signed-in admin only. Bypasses the one-a-day guard so it
 * can be pressed more than once (the (user, url) key still stops the same
 * listing twice); admins are never charged for picks.
 */
export async function sendTestPickAction(): Promise<void> {
  const user = await requireAdmin();
  const result = await runDailyPicks({ dry: false, onlyUserIds: [user.id], ignoreToday: true });
  await finish('test', result.body);
}

/** The full audience, no writes, no sends. */
export async function dryRunPicksAction(): Promise<void> {
  await requireAdmin();
  const result = await runDailyPicks({ dry: true });
  await finish('dry', result.body);
}

/** Who would get the "your picks have paused" letter right now; writes and sends nothing. */
export async function dryRunPausedAction(): Promise<void> {
  await requireAdmin();
  const result = await runPausedEmails({ dry: true });
  await finish('paused-dry', result.body);
}

/** Who would get the one-off "picks are now daily" notice; sends nothing. */
export async function dryRunDailyNoticeAction(): Promise<void> {
  await requireAdmin();
  const result = await runDailyNotice({ dry: true });
  await finish('notice-dry', result.body);
}

/**
 * Sends the notice to everyone who has picks on and has not had it. Each
 * profile is stamped as it goes, so pressing again only reaches whoever is
 * left. The page only shows this button after a dry run.
 */
export async function sendDailyNoticeAction(): Promise<void> {
  await requireAdmin();
  const result = await runDailyNotice({ dry: false });
  await finish('notice', result.body);
}
