import 'server-only';

/**
 * The reads behind "Changes on your deals": every member's pending alerts,
 * settled against their deals as they are now (./alerts.ts settleChanges).
 * One query per table for a whole run, never one per member, because the
 * picks passes have no time to spare.
 *
 * Anything that cannot be read returns an empty result: an email without
 * its changes is better than no email, and the alerts stay pending for the
 * next one.
 */
import type { createAdminClient } from '../supabase/admin';
import { ALERT_MAX_AGE_MS, settleChanges, type AlertRow, type CurrentState, type Settled } from './alerts';

type Admin = ReturnType<typeof createAdminClient>;

const ID_CHUNK = 150;
const PAGE = 1000;

function chunks<T>(list: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Which of these members have "Changes on deals I'm tracking" on. A read that fails reads as off: never send what may have been turned off. */
export async function trackedAlertsOn(admin: Admin, userIds: readonly string[]): Promise<Set<string>> {
  const on = new Set<string>();
  for (const some of chunks(userIds)) {
    const { data, error } = await admin.from('profiles').select('id, alert_tracked').in('id', some);
    if (error) {
      console.warn('[notify] alert_tracked read failed (schema behind?):', error.message);
      return new Set();
    }
    for (const r of (data ?? []) as { id: string; alert_tracked: boolean | null }[]) if (r.alert_tracked !== false) on.add(r.id);
  }
  return on;
}

/** Pending alerts for these members, settled. Members with none are absent. */
export async function pendingChanges(admin: Admin, userIds: readonly string[], now: Date = new Date()): Promise<Map<string, Settled>> {
  const out = new Map<string, Settled>();
  if (userIds.length === 0) return out;
  const since = new Date(now.getTime() - ALERT_MAX_AGE_MS).toISOString();
  const rows: AlertRow[] = [];
  for (const some of chunks(userIds)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from('deal_alerts')
        .select('id, user_id, alert_type, source, canonical_url, deal_id, checked_listing_id, event_at, created_at, payload')
        .in('user_id', some)
        .is('notified_at', null)
        .gte('created_at', since)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.warn('[notify] deal_alerts read failed (schema behind?):', error.message);
        return out;
      }
      rows.push(...((data ?? []) as AlertRow[]));
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  if (rows.length === 0) return out;

  const dealIds = [...new Set(rows.map((r) => r.deal_id).filter((x): x is string => Boolean(x)))];
  const rowIds = [...new Set(rows.map((r) => r.checked_listing_id).filter((x): x is string => Boolean(x)))];
  const deals = new Map<string, { status: string; priceAmount: number | null; pricePeriod: string | null }>();
  const pipeline = new Map<string, { stage: string | null; listingStatus: string | null }>();
  const passed = new Set<string>();
  for (const some of chunks(dealIds)) {
    const { data, error } = await admin.from('marketplace_deals').select('id, status, price_amount, price_period').in('id', some);
    if (error) console.warn('[notify] deal state read failed:', error.message);
    for (const d of (data ?? []) as { id: string; status: string; price_amount: number | string | null; price_period: string | null }[]) {
      const amount = d.price_amount === null ? null : Number(d.price_amount);
      deals.set(d.id, { status: d.status, priceAmount: Number.isFinite(amount) ? amount : null, pricePeriod: d.price_period });
    }
    for (const users of chunks([...new Set(rows.filter((r) => r.deal_id && some.includes(r.deal_id)).map((r) => r.user_id))])) {
      const { data: pass, error: passErr } = await admin.from('deal_reactions').select('user_id, deal_id').in('deal_id', some).in('user_id', users).eq('reaction', 'pass');
      if (passErr) console.warn('[notify] passes read failed:', passErr.message);
      for (const p of (pass ?? []) as { user_id: string; deal_id: string }[]) passed.add(`${p.user_id}:${p.deal_id}`);
    }
  }
  for (const some of chunks(rowIds)) {
    const { data, error } = await admin.from('checked_listings').select('id, status, listing_status').in('id', some);
    if (error) console.warn('[notify] pipeline state read failed:', error.message);
    for (const r of (data ?? []) as { id: string; status: string | null; listing_status: string | null }[]) pipeline.set(r.id, { stage: r.status, listingStatus: r.listing_status });
  }

  const current: CurrentState = { deals, rows: pipeline, passed };
  const byUser = new Map<string, AlertRow[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  for (const [userId, list] of byUser) out.set(userId, settleChanges(list, current, now));
  return out;
}
