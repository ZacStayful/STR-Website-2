import 'server-only';

/**
 * The one way into the activity log. Every batch records what members do
 * through these two, never by writing the table:
 *
 *   logActivity(userId, kind, opts)     in a page, a server action or a route
 *                                       handler. Returns at once: the write
 *                                       is handed to after() and happens once
 *                                       the response has gone, even when the
 *                                       action then redirects or throws.
 *   recordActivity(userId, kind, opts)  in code that already runs after the
 *                                       response (an after() callback, a
 *                                       webhook, a cron, the auto top-up).
 *                                       Awaitable, because after() may never
 *                                       run a callback registered that late.
 *
 * Neither ever throws, rejects, or holds up what it records: a failed write
 * is a warning in the logs and nothing else. What may be logged, and how, is
 * decided in event.ts; kinds are listed in kinds.ts.
 */
import { after } from 'next/server';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { buildActivityCall, type ActivityCall, type ActivityOptions } from './event';
import { isQualifying, type ActivityKind } from './kinds';
import { cameBack } from '../inactivity/came-back';

export type { ActivityOptions } from './event';
export type { ActivityKind } from './kinds';

/** 'production', 'preview' or 'development'. Anything but production is stamped on the event. */
function deployment(): string {
  return process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
}

// One warning a minute per message, so a missing table (schema not run) does
// not fill the logs with a line per click.
const warnedAt = new Map<string, number>();
function warn(message: string): void {
  const now = Date.now();
  if (now - (warnedAt.get(message) ?? 0) < 60_000) return;
  warnedAt.set(message, now);
  console.warn('[activity] not recorded:', message);
}

async function write(call: ActivityCall): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc('activity_log', { p: call });
    if (error) warn(error.message);
    // Batch 20, Part C: a qualifying action brings a quiet member back at once.
    else if (isQualifying(call.kind)) await cameBack(call.user);
  } catch (err) {
    warn(err instanceof Error ? err.message : String(err));
  }
}

function prepare(userId: unknown, kind: ActivityKind, opts: ActivityOptions | undefined, background: boolean): ActivityCall | null {
  if (!hasServiceRole()) return null;
  return buildActivityCall(userId, kind, opts, { now: new Date(), env: deployment(), background });
}

/** Record something a member did, after the response. Never throws, never waits. */
export function logActivity(userId: string | null | undefined, kind: ActivityKind, opts?: ActivityOptions): void {
  try {
    const call = prepare(userId, kind, opts, false);
    if (!call) return;
    try {
      after(() => write(call));
    } catch {
      // Outside a request (a script): write straight away.
      void write(call);
    }
  } catch (err) {
    warn(err instanceof Error ? err.message : String(err));
  }
}

/** Record something from code that already runs after the response. Never rejects. */
export async function recordActivity(userId: string | null | undefined, kind: ActivityKind, opts?: ActivityOptions): Promise<void> {
  try {
    const call = prepare(userId, kind, opts, true);
    if (call) await write(call);
  } catch (err) {
    warn(err instanceof Error ? err.message : String(err));
  }
}

/**
 * For the daily-pick email's own page (/p/<token>), where the pick token is
 * all there is: the member (and the deal) are found from it after the
 * response, so the page does no extra read. Never throws.
 */
export function logActivityForPick(token: string, kind: ActivityKind, opts?: Omit<ActivityOptions, 'source'>): void {
  const at = opts?.at ?? new Date();
  const run = async () => {
    try {
      if (!hasServiceRole()) return;
      const { data } = await createAdminClient().from('sourcing_sent').select('user_id, deal_id').eq('token', token).maybeSingle();
      const row = data as { user_id: string; deal_id: string | null } | null;
      if (!row) return;
      const call = buildActivityCall(row.user_id, kind, { dealId: row.deal_id, ...opts, at, source: 'email_link' }, { now: new Date(), env: deployment(), background: false });
      if (call) await write(call);
    } catch (err) {
      warn(err instanceof Error ? err.message : String(err));
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
