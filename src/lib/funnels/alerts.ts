import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { sendEmail } from '../email/send';
import { funnelAlertEmail, type FunnelAlertKind } from '../email/funnel-alerts';
import { getBalance } from '../credit/ledger';
import { dayWindow } from './windows';

export type { FunnelAlertKind } from '../email/funnel-alerts';

/**
 * Telling a funnel's owner when their funnel has stopped working.
 *
 * Four walls, all of them silent before this: out of credit so reports queue,
 * the daily enquiry cap, the daily spend ceiling, and a prospect landing on a
 * paused link. Each one means enquiries are being lost or left unanswered right
 * now, and the only person who can fix it is the owner.
 *
 * Two halves, deliberately:
 *
 *   - `raiseFunnelAlert` is the EVENT. It fires from the request that hit the
 *     wall, dedupes to one email per funnel per kind per UTC day, and can
 *     never throw into its caller: a prospect's submission must not fail
 *     because we could not send someone an email about it.
 *   - `funnelWalls` is the STATE, for the banner in the app. It asks what is
 *     true right now rather than reading the alert log, because the log
 *     records that we told them and the banner has to say whether it still
 *     applies.
 */

/**
 * Records the wall and emails the owner the first time it is hit today.
 *
 * `funnel_alert_claim` is the decision, and it is a SQL function so that the
 * insert and the answer are one statement: whoever creates the row sends,
 * everyone else gets false and stays quiet. Read-then-write would have every
 * concurrent request decide it was first and send its own copy.
 *
 * Never throws and never returns a failure. Every caller is on a path where a
 * prospect is waiting, so an unreachable table, an unset RESEND_API_KEY or a
 * schema that has not been migrated yet all have to be survivable — the
 * notification is the least important thing happening on that request.
 */
export async function raiseFunnelAlert(
  kind: FunnelAlertKind,
  funnel: { id: string; userId: string; name: string },
): Promise<void> {
  try {
    if (!hasServiceRole()) return;
    const admin = createAdminClient();

    const { data, error } = await admin.rpc('funnel_alert_claim', {
      p_funnel: funnel.id,
      p_kind: kind,
      p_day: dayWindow(),
    });
    if (error) {
      console.error(`[funnels] alert ${kind} could not be recorded:`, error.message);
      return;
    }
    // Somebody else already claimed it today, so they have already been told.
    if (data !== true) return;

    const { data: profile } = await admin
      .from('profiles')
      .select('email')
      .eq('id', funnel.userId)
      .maybeSingle();
    const to = typeof profile?.email === 'string' ? profile.email : null;
    if (!to) {
      // Not transient, so the claim stays: retrying a lookup that cannot
      // succeed on every submission all day would only make noise.
      console.warn(`[funnels] alert ${kind} for ${funnel.id}: owner has no email on file`);
      return;
    }

    const email = funnelAlertEmail({ kind, funnelName: funnel.name, funnelId: funnel.id });
    // Ours, not the customer's brand: this is Stayful telling them about their
    // account, not their funnel talking to one of their prospects.
    const result = await sendEmail({ to, subject: email.subject, html: email.html, text: email.text });
    if (!result.sent) {
      // The claim has to go back. It exists to stop us sending twice, not to
      // stop us sending at all: leaving it behind would let one Resend outage
      // silence this for the rest of the day, which is exactly the situation
      // the alert is here to prevent. The next prospect to hit the same wall
      // claims it again and tries once more.
      await admin
        .from('funnel_alerts')
        .delete()
        .eq('funnel_id', funnel.id)
        .eq('kind', kind)
        .eq('day', dayWindow());
      console.error(`[funnels] alert ${kind} for ${funnel.id} not sent (${result.reason ?? 'unknown'}); will retry`);
    }
  } catch (err) {
    console.error(`[funnels] alert ${kind} failed:`, err);
  }
}

export interface FunnelWall {
  kind: FunnelAlertKind;
  /** One line, for a banner in the app. */
  message: string;
}

/**
 * Which walls a funnel is up against right now.
 *
 * Derived from live state, never from `funnel_alerts`: that table says we sent
 * an email, which stays true for the rest of the day even after the customer
 * has topped up. A banner that outlives the problem is worse than no banner,
 * because the next one gets ignored.
 *
 * `paused_hit` is not here. It is an event that happened, not a condition that
 * holds, and the app already shows a funnel as paused.
 */
export async function funnelWalls(funnel: {
  id: string;
  userId: string;
  dailyCap: number;
  dailySpendCapPence: number;
}): Promise<FunnelWall[]> {
  if (!hasServiceRole()) return [];
  const admin = createAdminClient();
  const walls: FunnelWall[] = [];

  try {
    const [{ data: today }, { count: queued }, balance] = await Promise.all([
      admin
        .from('funnel_hits')
        .select('bucket, hits, spend_base_pence')
        .eq('funnel_id', funnel.id)
        .eq('window_start', dayWindow())
        .eq('bucket', 'funnel')
        .maybeSingle(),
      admin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('funnel_id', funnel.id)
        .eq('status', 'queued')
        .is('archived_at', null),
      getBalance(funnel.userId).catch(() => null),
    ]);

    // Leads waiting on credit. The count is what makes this worth saying: "3
    // enquiries waiting" is a reason to act, "top up" on its own is not.
    if ((queued ?? 0) > 0) {
      const n = queued ?? 0;
      const broke = !balance || balance.spendableBasePence <= 0;
      if (broke) {
        walls.push({
          kind: 'out_of_credit',
          message: `${n} ${n === 1 ? 'enquiry is' : 'enquiries are'} waiting on credit. ${n === 1 ? 'Its report runs' : 'Their reports run'} by itself once you top up.`,
        });
      }
    }

    const hits = Number(today?.hits ?? 0) || 0;
    if (funnel.dailyCap > 0 && hits >= funnel.dailyCap) {
      walls.push({
        kind: 'daily_cap',
        message: `Today's enquiry limit of ${funnel.dailyCap} is used up, so this funnel is turning people away until midnight.`,
      });
    }

    const spent = Number(today?.spend_base_pence ?? 0) || 0;
    if (funnel.dailySpendCapPence > 0 && spent >= funnel.dailySpendCapPence) {
      walls.push({
        kind: 'spend_cap',
        message: `Today's spend limit is reached, so reports are not running until midnight. Enquiries still arrive and are still saved.`,
      });
    }
  } catch (err) {
    // A banner is not worth failing a page over.
    console.error('[funnels] wall state failed:', err);
    return [];
  }

  return walls;
}

/**
 * `raiseFunnelAlert` for a caller that only has the funnel's id.
 *
 * The public funnel page is the one such caller, and it stays that way on
 * purpose: `PublicFunnel` omits the owner's id precisely so a page that is
 * public at its URL cannot carry it, so the owner is resolved here instead of
 * being handed down through the render.
 */
export async function raiseFunnelAlertById(kind: FunnelAlertKind, funnelId: string): Promise<void> {
  try {
    if (!hasServiceRole()) return;
    const { data, error } = await createAdminClient()
      .from('funnels')
      .select('id, user_id, name')
      .eq('id', funnelId)
      .maybeSingle();
    if (error || !data) return;
    const r = data as Record<string, unknown>;
    await raiseFunnelAlert(kind, {
      id: String(r.id),
      userId: String(r.user_id),
      name: typeof r.name === 'string' ? r.name : 'Your funnel',
    });
  } catch (err) {
    console.error(`[funnels] alert ${kind} by id failed:`, err);
  }
}
