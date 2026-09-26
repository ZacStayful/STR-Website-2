import 'server-only';

/**
 * The 06:55 collector (/api/internal/deal-alerts): turns what changed on the
 * deals each member tracks into deal_alerts rows, for that morning's daily
 * email to carry. It runs after everything that records a change:
 * listing-recheck (06:00, pipeline rows), marketplace-recheck (:30 each
 * hour) and the sweep's last pass (06:50).
 *
 * Tracked = Batch 5's loadTrackedDeals, scope 'own'. Writing is idempotent:
 * the unique key (member, type, deal, event time) makes a second run, or a
 * re-run after a crash, write nothing new. Nothing here sends anything.
 */
import { createAdminClient } from '../supabase/admin';
import { isAdminEmail } from '../admin';
import { payersForAll } from './daily-server';
import { figureLine } from './message';
import { alertsFor, type AlertedBefore, type AlertInsert, type TrackedForAlerts } from './alerts';
import { trackedPlace, trackingFor, type MemberTracking } from './tracked-read';
import { describeType } from '../marketplace/grid';
import { parseHistory } from '../listing/recheck';

const PAGE = 1000;
const ID_CHUNK = 150;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;
/** Members per batch: read, decided and written before the next. */
const BATCH = 40;
/** Stop starting batches here; the route's limit is 60 s. */
const TIME_BUDGET_MS = 40_000;

/** A member's place in today's order: a stable hash of id and day. */
function rotation(id: string, day: string): number {
  let h = 2166136261;
  for (const ch of `${day}:${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export interface RunResult {
  status: number;
  body: Record<string, unknown>;
}

function chunks<T>(list: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The tracked deals of one member, as alertsFor reads them. */
function itemsOf(t: MemberTracking): TrackedForAlerts[] {
  const out: TrackedForAlerts[] = [];
  for (const v of t.load.view) {
    if (!v.mine) continue;
    const card = v.dealId ? t.load.cards.get(v.dealId) : undefined;
    const place = trackedPlace(t, v);
    const opened = v.opened;
    const revived = v.dealId ? t.revived.get(v.dealId) : undefined;
    const amount = card?.price_amount === null || card?.price_amount === undefined ? null : Number(card.price_amount);
    out.push({
      key: v.key,
      stage: v.stage,
      kind: v.kind === 'rent' ? 'rent' : 'sale',
      opened,
      address: opened ? place : null,
      town: card?.town ?? null,
      type: card ? describeType(card) || null : null,
      dealId: v.dealId,
      checkedListingId: v.checkedListingId,
      trackedSince: v.lastChangedAt,
      pipelineHistory: v.checkedListingId ? t.pipelineHistory.get(v.checkedListingId) ?? null : null,
      pipelineDeal: v.checkedListingId ? (t.pipelineDeal.get(v.checkedListingId) as TrackedForAlerts['pipelineDeal']) ?? null : null,
      deal: card
        ? {
            status: card.status,
            priceAmount: Number.isFinite(amount) ? amount : null,
            pricePeriod: card.price_period,
            figure: figureLine(card),
            liveSince: card.live_since ?? null,
            retiredReason: card.retired_reason,
            retiredAt: card.retired_at,
            history: parseHistory(card.price_history),
            revivedAt: revived?.at ?? null,
            revivedFrom: revived?.from ?? null,
          }
        : null,
    });
  }
  return out;
}

export async function runCollector(opts: { dry: boolean; onlyUserIds?: string[] }): Promise<RunResult> {
  const started = Date.now();
  const now = new Date();
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }

  // ── Members with "Changes on deals I'm tracking" on. The column missing = nobody (never send what may be off). ──
  const members: { id: string; email: string; admin: boolean }[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = admin.from('profiles').select('id, email, alert_tracked').not('email', 'is', null);
    if (opts.onlyUserIds) q = q.in('id', opts.onlyUserIds);
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { status: 503, body: { error: `profiles read failed (schema behind?): ${error.message}` } };
    for (const r of (data ?? []) as { id: string; email: string; alert_tracked: boolean | null }[]) if (r.alert_tracked !== false) members.push({ id: r.id, email: r.email, admin: isAdminEmail(r.email) });
    if ((data?.length ?? 0) < PAGE) break;
  }
  if (members.length === 0) return { status: 200, body: { dry: opts.dry, members: 0, alerts: 0 } };

  // A few members at a time, each batch written before the next is read, so a
  // run that meets its time budget keeps what it did. The order rotates daily,
  // so at a size one run cannot cover it is never the same members left over.
  const day = now.toISOString().slice(0, 10);
  const ordered = [...members].sort((a, b) => rotation(a.id, day) - rotation(b.id, day));
  const perUser: { user: string; tracked: number; alerts: { type: string; deal: string; at: string }[] }[] = [];
  let candidates = 0;
  let tracked = 0;
  let written = 0;
  let reached = 0;
  let ranOutOfTime = false;
  const collectBatch = async (batch: typeof members) => {
    const tracking = await trackingFor(admin, batch);
    const ids = [...tracking.keys()];

    // ── What each member was already alerted about (the drop floor, the fortnightly "back") ──
    const lowestDrop = new Map<string, Map<string, number>>();
    const lastBack = new Map<string, Map<string, number>>();
    const lastGone = new Map<string, Map<string, { at: number; status: string }>>();
    const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
    for (const some of chunks(ids)) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin.from('deal_alerts').select('user_id, alert_type, deal_key, event_at, payload').in('user_id', some).in('alert_type', ['price_drop', 'back_on_market', 'gone']).gte('event_at', since).order('id', { ascending: true }).range(from, from + PAGE - 1);
        if (error) throw new Error(`deal_alerts read failed (schema behind?): ${error.message}`);
        for (const r of (data ?? []) as { user_id: string; alert_type: string; deal_key: string; event_at: string; payload: { newAmount?: number; status?: string } | null }[]) {
          if (r.alert_type === 'gone' && r.payload?.status) {
            const m = lastGone.get(r.user_id) ?? new Map<string, { at: number; status: string }>();
            const at = Date.parse(r.event_at);
            if (at > (m.get(r.deal_key)?.at ?? -Infinity)) m.set(r.deal_key, { at, status: r.payload.status });
            lastGone.set(r.user_id, m);
          }
          if (r.alert_type === 'price_drop' && typeof r.payload?.newAmount === 'number') {
            const m = lowestDrop.get(r.user_id) ?? new Map<string, number>();
            m.set(r.deal_key, Math.min(m.get(r.deal_key) ?? Infinity, r.payload.newAmount));
            lowestDrop.set(r.user_id, m);
          }
          if (r.alert_type === 'back_on_market') {
            const m = lastBack.get(r.user_id) ?? new Map<string, number>();
            m.set(r.deal_key, Math.max(m.get(r.deal_key) ?? -Infinity, Date.parse(r.event_at)));
            lastBack.set(r.user_id, m);
          }
        }
        if ((data?.length ?? 0) < PAGE) break;
      }
    }

    // ── Watchers: other ACCOUNTS (team = its owner) that opened or kept each live tracked deal this week ──
    const liveDeals = [...new Set([...tracking.values()].flatMap((t) => t.load.view.filter((v) => v.dealId && t.load.cards.get(v.dealId)?.status === 'live').map((v) => v.dealId!)))];
    const watcherAccounts = new Map<string, Set<string>>();
    const weekAgo = new Date(now.getTime() - WEEK_MS).toISOString();
    const keepers: { user_id: string; deal_id: string }[] = [];
    for (const some of chunks(liveDeals)) {
      // A daily pick's automatic open is not interest: one listing can go to three members a day.
      const { data: opens, error: openErr } = await admin.from('deal_opens').select('user_id, deal_id, verified_via').in('deal_id', some).eq('status', 'open').gte('opened_at', weekAgo);
      if (openErr) console.warn('[collect] opens read failed:', openErr.message);
      for (const o of (opens ?? []) as { user_id: string; deal_id: string; verified_via: string | null }[]) if (o.verified_via !== 'pick') watcherAccounts.set(o.deal_id, new Set([...(watcherAccounts.get(o.deal_id) ?? []), o.user_id]));
      const { data: keeps, error: keepErr } = await admin.from('deal_reactions').select('user_id, deal_id').in('deal_id', some).eq('reaction', 'keep').gte('updated_at', weekAgo);
      if (keepErr) console.warn('[collect] keeps read failed:', keepErr.message);
      keepers.push(...((keeps ?? []) as { user_id: string; deal_id: string }[]));
    }
    const keeperPayers = await payersForAll([...new Set(keepers.map((k) => k.user_id))]);
    for (const k of keepers) watcherAccounts.set(k.deal_id, new Set([...(watcherAccounts.get(k.deal_id) ?? []), keeperPayers.get(k.user_id)?.payerId ?? k.user_id]));
    // Admins' own browsing is not market interest.
    const accountIds = [...new Set([...watcherAccounts.values()].flatMap((s) => [...s]))];
    const adminAccounts = new Set<string>();
    for (const some of chunks(accountIds)) {
      const { data } = await admin.from('profiles').select('id, email').in('id', some);
      for (const p of (data ?? []) as { id: string; email: string | null }[]) if (p.email && isAdminEmail(p.email)) adminAccounts.add(p.id);
    }
    const memberPayers = await payersForAll(ids);

    // ── Decide and write ──
    const inserts: AlertInsert[] = [];
    for (const [userId, t] of tracking) {
      const own = memberPayers.get(userId)?.payerId ?? userId;
      const watchers = new Map<string, number>();
      for (const [dealId, accounts] of watcherAccounts) watchers.set(dealId, [...accounts].filter((a) => a !== own && !adminAccounts.has(a)).length);
      const before: AlertedBefore = { lowestDrop: lowestDrop.get(userId) ?? new Map(), lastBack: lastBack.get(userId) ?? new Map(), lastGone: lastGone.get(userId) ?? new Map() };
      const items = itemsOf(t);
      const mine = alertsFor(userId, items, watchers, before, now);
      inserts.push(...mine);
      perUser.push({ user: userId, tracked: items.length, alerts: mine.map((a) => ({ type: a.alert_type, deal: a.deal_key, at: a.event_at })) });
    }
    candidates += inserts.length;
    tracked += [...tracking.values()].reduce((n, t) => n + t.load.view.length, 0);
    if (!opts.dry) {
      for (const some of chunks(inserts, 500)) {
        const { data, error } = await admin.from('deal_alerts').upsert(some, { onConflict: 'user_id,alert_type,deal_key,event_at', ignoreDuplicates: true }).select('id');
        if (error) throw new Error(`deal_alerts write failed: ${error.message}`);
        written += data?.length ?? 0;
      }
    }
  };
  try {
    for (let i = 0; i < ordered.length; i += BATCH) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        ranOutOfTime = true;
        break;
      }
      const batch = ordered.slice(i, i + BATCH);
      await collectBatch(batch);
      reached += batch.length;
    }
  } catch (err) {
    console.error('[collect]', (err as Error)?.message ?? err);
    return { status: 500, body: { error: (err as Error)?.message ?? 'collect failed', written, reached } };
  }
  const body = { dry: opts.dry, members: members.length, reached, ranOutOfTime, tracked, candidates, written, ms: Date.now() - started, perUser: perUser.filter((p) => p.alerts.length > 0) };
  console.log('[collect] run', JSON.stringify({ dry: body.dry, members: body.members, reached, ranOutOfTime, tracked, candidates, written, ms: body.ms }));
  return { status: 200, body };
}
