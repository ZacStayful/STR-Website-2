import 'server-only';

/**
 * One heartbeat from a member's browser (POST /api/presence), handled after
 * the response. It moves or starts the member's visit
 * (public.activity_visit_touch), then records what the ping says was seen:
 *
 *   today_view   Today on screen: once a UK day, and once more if they look
 *                both before and after the day's list changes at 07:00 UTC
 *   deal_view    a deal page on screen: once per deal per UK day
 *   report_view  a saved report on screen: once per report per UK day
 *   explorer_view / my_deals_view   the Explorer or My deals on screen: once a UK day (Batch 21, E6)
 *   email_click / sms_click   the page was reached from our email or text:
 *                once per visit, and never counting towards weekly active
 *
 * Views are logged from the browser, when the page is really on screen, so a
 * link prefetch can never count as one. Never throws.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { todayKey } from '../today/day';
import { parsePing } from './heartbeat';
import { recordActivity } from './log';
import { ukDay } from './week';

const warnedAt = new Map<string, number>();
function warn(message: string): void {
  const now = Date.now();
  if (now - (warnedAt.get(message) ?? 0) < 60_000) return;
  warnedAt.set(message, now);
  console.warn('[presence] visit not recorded:', message);
}

export async function handlePresence(userId: string, raw: unknown, now: Date = new Date()): Promise<void> {
  const ping = parsePing(raw);
  if (!ping || !hasServiceRole()) return;

  let visitId: string | null = null;
  try {
    const { data, error } = await createAdminClient().rpc('activity_visit_touch', {
      p: { user: userId, kind: ping.kind, pages: ping.pages ?? 0, via: ping.via ?? null, at: now.toISOString() },
    });
    if (error) warn(error.message);
    else if (typeof data === 'string') visitId = data;
  } catch (err) {
    warn(err instanceof Error ? err.message : String(err));
  }

  const day = ukDay(now);
  const logged: Promise<void>[] = [];
  if (ping.via && visitId) {
    // Batch 21 (E12): the row says where it came from, not 'web'.
    logged.push(recordActivity(userId, ping.via === 'email' ? 'email_click' : 'sms_click', { dedupeKey: `${ping.via}_click:${visitId}`, at: now, source: ping.via === 'email' ? 'email_link' : 'sms_link' }));
  }
  const view = ping.view;
  if (view?.type === 'today') {
    logged.push(recordActivity(userId, 'today_view', { dedupeKey: `today_view:${day}:${todayKey(now)}`, at: now }));
  } else if (view?.type === 'deal') {
    logged.push(recordActivity(userId, 'deal_view', { dealId: view.id, dedupeKey: `deal_view:${view.id}:${day}`, at: now }));
  } else if (view?.type === 'report') {
    logged.push(recordActivity(userId, 'report_view', { extras: { report: view.id }, dedupeKey: `report_view:${view.id}:${day}`, at: now }));
  } else if (view?.type === 'explorer') {
    logged.push(recordActivity(userId, 'explorer_view', { dedupeKey: `explorer_view:${day}`, at: now }));
  } else if (view?.type === 'my_deals') {
    logged.push(recordActivity(userId, 'my_deals_view', { dedupeKey: `my_deals_view:${day}`, at: now }));
  }
  await Promise.all(logged);
}
