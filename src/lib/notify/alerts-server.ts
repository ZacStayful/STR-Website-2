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
import { parseMarketGoals, type MarketGoals } from '../market/goals';
import { alertGapLine, cashBuyerOf, memberFinance, mostYouCanPay } from '../marketplace/most-you-can-pay';
import { widthFor } from '../marketplace/profit-range';
import { getBillingSettings } from '../credit/unit-costs';
import { projectCardsFor } from '../marketplace/queries';

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
        .select('id, user_id, alert_type, source, deal_key, deal_id, checked_listing_id, event_at, created_at, payload')
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
  // Batch 14: each deal's income for "most you can pay" (the card's own figures, never an address).
  const incomes = new Map<string, { kind: 'sale' | 'rent'; grossRevenue: string | number | null; confidence: string | null; bedrooms: number | null }>();
  const pipeline = new Map<string, { stage: string | null; listingStatus: string | null }>();
  const passed = new Set<string>();
  for (const some of chunks(dealIds)) {
    const { data, error } = await admin.from('marketplace_deals').select('id, status, price_amount, price_period').in('id', some);
    if (error) console.warn('[notify] deal state read failed:', error.message);
    for (const d of (data ?? []) as { id: string; status: string; price_amount: number | string | null; price_period: string | null }[]) {
      const amount = d.price_amount === null ? null : Number(d.price_amount);
      deals.set(d.id, { status: d.status, priceAmount: Number.isFinite(amount) ? amount : null, pricePeriod: d.price_period });
    }
    // Its own read, so a failure costs only the "most you can pay" line.
    const inc = await admin.from('marketplace_deals').select('id, kind, bedrooms, screening_gross:screening->grossRevenue->>value, screening_confidence:screening->>confidence').in('id', some);
    if (inc.error) console.warn('[notify] deal income read failed:', inc.error.message);
    for (const d of (inc.data ?? []) as unknown as { id: string; kind: string; bedrooms: number | null; screening_gross: string | null; screening_confidence: string | null }[]) {
      if (d.kind === 'sale' || d.kind === 'rent') incomes.set(d.id, { kind: d.kind, grossRevenue: d.screening_gross, confidence: d.screening_confidence, bedrooms: d.bedrooms });
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
  await attachPayGaps(admin, out, incomes).catch((err) => console.warn('[notify] pay gaps skipped:', (err as Error)?.message ?? err));
  return out;
}

/**
 * Batch 14: a price drop says where the new price sits against the most the
 * member can pay for their own monthly profit, at the finance of the profile
 * the deal is tracked under (the member's live answers when it is untagged).
 * Best effort: without it the email is exactly as before.
 */
async function attachPayGaps(admin: Admin, out: Map<string, Settled>, incomes: ReadonlyMap<string, { kind: 'sale' | 'rent'; grossRevenue: string | number | null; confidence: string | null; bedrooms: number | null }>): Promise<void> {
  const all = [...out.entries()].flatMap(([userId, s]) => s.changes.filter((c) => c.alertType === 'price_drop' && c.dealId && incomes.has(c.dealId)).map((c) => ({ userId, c })));
  if (all.length === 0) return;
  // Batch 17: "most you can pay" assumes a finished house, so a Project deal never gets the gap line.
  const projects = await projectCardsFor([...new Set(all.map((d) => d.c.dealId!))]);
  const drops = all.filter((d) => !projects.has(d.c.dealId!));
  if (drops.length === 0) return;
  const profileIds = [...new Set(drops.map((d) => d.c.profileId).filter((x): x is string => Boolean(x)))];
  const userIds = [...new Set(drops.filter((d) => !d.c.profileId).map((d) => d.userId))];
  const goalsByProfile = new Map<string, MarketGoals | null>();
  const goalsByUser = new Map<string, MarketGoals | null>();
  for (const some of chunks(profileIds)) {
    const { data } = await admin.from('search_profiles').select('id, criteria').in('id', some);
    for (const r of (data ?? []) as { id: string; criteria: unknown }[]) goalsByProfile.set(r.id, parseMarketGoals(r.criteria));
  }
  for (const some of chunks(userIds)) {
    const { data } = await admin.from('profiles').select('id, market_goals').in('id', some);
    for (const r of (data ?? []) as { id: string; market_goals: unknown }[]) goalsByUser.set(r.id, parseMarketGoals(r.market_goals));
  }
  const { dealPricing } = await getBillingSettings();
  for (const { userId, c } of drops) {
    const income = incomes.get(c.dealId!)!;
    const goals = c.profileId ? goalsByProfile.get(c.profileId) ?? null : goalsByUser.get(userId) ?? null;
    const pay = mostYouCanPay({ kind: income.kind, grossRevenue: income.grossRevenue, bedrooms: income.bedrooms, finance: memberFinance(goals), cashBuyer: cashBuyerOf(goals), widthPct: widthFor(income.confidence, dealPricing.profitRangePct) });
    const amount = c.newAmount === null || c.newAmount === undefined ? null : Number(c.newAmount);
    c.payGap = pay ? alertGapLine(amount, pay) : null;
  }
}
