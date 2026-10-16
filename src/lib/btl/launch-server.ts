import 'server-only';

/**
 * The buy-to-let launch line's reads and its one write (./launch.ts): which
 * of a daily email's members are due it today, and the flag that says it
 * went. The daily senders (picks run, daily digest) call these; a dry run
 * reads and never marks. profiles.btl_launch_line_at is not an access column
 * and is never read by the access checks.
 */
import type { createAdminClient } from '../supabase/admin';
import { readBtlSettingsCached } from './settings-server';
import { btlLaunchDue } from './launch';

type Admin = ReturnType<typeof createAdminClient>;

const ID_CHUNK = 200;

/**
 * The members (of those given, each with whether a profile of theirs already
 * shows Buy to let) the launch line is due for today. Empty before
 * btl_launch_from, and on any failure (the column not there yet included):
 * the email then goes exactly as it would have.
 */
export async function btlLaunchDueFor(admin: Admin, members: readonly { id: string; hasBtl: boolean }[], now: Date = new Date()): Promise<Set<string>> {
  const out = new Set<string>();
  const { settings } = await readBtlSettingsCached(admin);
  if (!btlLaunchDue({ launchFrom: settings.launchFrom, now, lineAt: null, hasBtl: false })) return out;
  const want = [...new Set(members.filter((m) => !m.hasBtl).map((m) => m.id))];
  for (let i = 0; i < want.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('profiles').select('id, btl_launch_line_at').in('id', want.slice(i, i + ID_CHUNK));
    if (error) {
      console.warn('[btl] launch line unreadable; not sent today:', error.message);
      return new Set();
    }
    for (const r of (data ?? []) as { id: string; btl_launch_line_at: string | null }[]) {
      if (btlLaunchDue({ launchFrom: settings.launchFrom, now, lineAt: r.btl_launch_line_at, hasBtl: false })) out.add(r.id);
    }
  }
  return out;
}

/** The line went in this member's email: never again. Only when it is still unset, so a second sender cannot move the date. */
export async function markBtlLaunchSent(admin: Admin, userId: string, now: Date = new Date()): Promise<void> {
  const { error } = await admin.from('profiles').update({ btl_launch_line_at: now.toISOString() }).eq('id', userId).is('btl_launch_line_at', null);
  if (error) console.error('[btl] launch line not marked:', error.message);
}
