/**
 * Alerts on the deals a member tracks (Part C): one model for pipeline rows
 * and kept marketplace deals, stored in deal_alerts.
 *
 * This file is the send-time half: `settleChanges` takes a member's pending
 * alerts and what their deals look like NOW, and decides what the next email
 * says. The collector (the 06:55 cron) writes the alerts; the daily email,
 * the picks-paused letter and the 08:10 digest read them through this.
 *
 * The rules, so an email never says something that stopped being true:
 *   - Passed or Secured (the member's own) never alerts.
 *   - One stream per deal: a deal on both lists (a pipeline row and a kept
 *     marketplace deal share B5's key, d-<deal id>) is told once.
 *   - Price drops collapse: first price → price now. If "now" is not lower
 *     than where it started, there is no drop to tell.
 *   - A price drop on a deal that has since gone is not told; the "gone" is.
 *   - Of "gone" and "back on the market", only the latest is told.
 *   - Back on the market and "getting attention" need the deal live now.
 *
 * Pure: no network, no database, no server-only.
 */
import type { AlertType, ChangeInput } from './message.ts';
import type { PriceHistoryEntry } from '../listing/recheck.ts';

/** Alerts older than this are dropped rather than sent: a switch turned back on never floods. */
export const ALERT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** What the collector stores in deal_alerts.payload. `address` only ever when the member opened the deal. */
export interface AlertPayload {
  kind?: 'sale' | 'rent';
  opened?: boolean;
  address?: string | null;
  town?: string | null;
  type?: string | null;
  stage?: string | null;
  oldAmount?: number | null;
  newAmount?: number | null;
  period?: string | null;
  figure?: string | null;
  status?: string | null;
  previousStatus?: string | null;
  watchers?: number | null;
}

export interface AlertRow {
  id: string;
  user_id: string;
  alert_type: AlertType;
  source: 'pipeline' | 'marketplace';
  deal_key: string;
  deal_id: string | null;
  checked_listing_id: string | null;
  event_at: string;
  created_at: string;
  payload: AlertPayload | null;
}

/** What the member's deals look like now. Anything unknown is left out and the stored payload is trusted. */
export interface CurrentState {
  deals: ReadonlyMap<string, { status: string; priceAmount: number | null; pricePeriod: string | null }>;
  rows: ReadonlyMap<string, { stage: string | null; listingStatus: string | null }>;
  /** `${userId}:${dealId}` for every Pass on the grid. */
  passed: ReadonlySet<string>;
}

const QUIET_STAGES: ReadonlySet<string> = new Set(['passed', 'secured']);
const GONE_LISTING: ReadonlySet<string> = new Set(['sold', 'under_offer', 'let_agreed', 'removed']);

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

function toChange(r: AlertRow, over: Partial<ChangeInput> = {}): ChangeInput {
  const p = r.payload ?? {};
  return {
    id: r.id,
    alertType: r.alert_type,
    kind: p.kind === 'rent' ? 'rent' : 'sale',
    opened: p.opened === true,
    address: p.opened === true ? p.address ?? null : null,
    town: p.town ?? null,
    type: p.type ?? null,
    stage: p.stage ?? null,
    dealId: r.deal_id,
    checkedListingId: r.checked_listing_id,
    oldAmount: p.oldAmount ?? null,
    newAmount: p.newAmount ?? null,
    period: p.period ?? null,
    figure: p.figure ?? null,
    status: p.status ?? null,
    previousStatus: p.previousStatus ?? null,
    watchers: p.watchers ?? null,
    ...over,
  };
}

export interface Settled {
  /** What to tell, oldest deal first. Each carries every alert id it stands for (id + mergedIds). */
  changes: (ChangeInput & { mergedIds: string[] })[];
  /** Alerts that will not be told (passed, gone, superseded, no longer true). Left to expire. */
  dismissed: string[];
}

/** One member's pending alerts, settled against now. */
export function settleChanges(rows: readonly AlertRow[], current: CurrentState, now: Date = new Date()): Settled {
  const dismissed: string[] = [];
  const live: AlertRow[] = [];
  for (const r of rows) {
    if (now.getTime() - time(r.created_at) > ALERT_MAX_AGE_MS) {
      dismissed.push(r.id);
      continue;
    }
    const row = r.checked_listing_id ? current.rows.get(r.checked_listing_id) : undefined;
    const stage = row?.stage ?? r.payload?.stage ?? null;
    if ((stage && QUIET_STAGES.has(stage)) || (r.deal_id && current.passed.has(`${r.user_id}:${r.deal_id}`))) {
      dismissed.push(r.id);
      continue;
    }
    live.push(r);
  }

  // Group by deal (B5's key): one stream per deal, whichever list it is on.
  const byUrl = new Map<string, AlertRow[]>();
  for (const r of live) byUrl.set(r.deal_key, [...(byUrl.get(r.deal_key) ?? []), r]);

  const changes: Settled['changes'] = [];
  for (const list of byUrl.values()) {
    list.sort((a, b) => time(a.event_at) - time(b.event_at));
    const dealRow = list.find((r) => r.deal_id && current.deals.has(r.deal_id));
    const deal = dealRow?.deal_id ? current.deals.get(dealRow.deal_id) : undefined;
    const pipe = list.find((r) => r.checked_listing_id && current.rows.has(r.checked_listing_id));
    const listing = pipe?.checked_listing_id ? current.rows.get(pipe.checked_listing_id) : undefined;
    const goneNow = deal ? deal.status === 'retired' : listing ? GONE_LISTING.has(listing.listingStatus ?? '') : false;
    const liveNow = deal ? deal.status === 'live' : listing ? !GONE_LISTING.has(listing.listingStatus ?? '') : true;

    // ── Status: only the latest of gone / back is told ──
    const statusEvents = list.filter((r) => r.alert_type === 'gone' || r.alert_type === 'back_on_market');
    const latestStatus = statusEvents[statusEvents.length - 1];
    for (const r of statusEvents) if (r !== latestStatus) dismissed.push(r.id);
    let toldGone = false;
    if (latestStatus) {
      if (latestStatus.alert_type === 'back_on_market' && !liveNow) dismissed.push(latestStatus.id);
      else {
        changes.push({ ...toChange(latestStatus), mergedIds: [] });
        toldGone = latestStatus.alert_type === 'gone';
      }
    }

    // ── Price: first → now, only while it is still on the market ──
    const drops = list.filter((r) => r.alert_type === 'price_drop');
    if (drops.length > 0) {
      const first = drops[0];
      const last = drops[drops.length - 1];
      const period = last.payload?.period ?? null;
      const nowPrice = deal && deal.priceAmount !== null && deal.pricePeriod === period ? deal.priceAmount : (last.payload?.newAmount ?? null);
      const oldAmount = first.payload?.oldAmount ?? null;
      const lower = typeof oldAmount === 'number' && typeof nowPrice === 'number' && nowPrice < oldAmount;
      if (toldGone || goneNow || !lower) dismissed.push(...drops.map((r) => r.id));
      else {
        // The figure was computed at the last drop's price: only true if that is still the price.
        const figure = nowPrice === (last.payload?.newAmount ?? null) ? last.payload?.figure ?? null : null;
        changes.push({ ...toChange(last, { oldAmount, newAmount: nowPrice, figure }), mergedIds: drops.filter((r) => r !== last).map((r) => r.id) });
      }
    }

    // ── Attention: once, and only while it is live ──
    for (const r of list.filter((x) => x.alert_type === 'nearly_gone')) {
      if (!liveNow || goneNow || toldGone) dismissed.push(r.id);
      else changes.push({ ...toChange(r), mergedIds: [] });
    }
  }
  return { changes, dismissed };
}

/**
 * Whether a recorded price change is a real one. diffListing compares amounts
 * without their period, so a portal re-labelling a rent between pw and pcm
 * reads as a 4.3× move. No real asking price moves 3× between two readings:
 * treat that as a relabel, never as a drop (or a rise) to tell anyone about.
 */
export function plausiblePriceChange(previous: number | null | undefined, next: number | null | undefined): boolean {
  if (typeof previous !== 'number' || typeof next !== 'number' || !(previous > 0) || !(next > 0)) return false;
  return Math.max(previous, next) / Math.min(previous, next) < 3;
}

/** Every alert id a list of settled changes stands for: what finishSend marks notified. */
export function alertIdsOf(changes: readonly { id: string; mergedIds?: string[] }[]): string[] {
  return changes.flatMap((c) => [c.id, ...(c.mergedIds ?? [])]);
}

// ── Collecting: what changed on a member's tracked deals (the 06:55 cron) ──

const GONE_REASONS: ReadonlySet<string> = new Set(['sold', 'under_offer', 'let_agreed', 'removed']);
/** A deal can come back on the market once a fortnight at most, as far as alerts go. */
export const BACK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
/** "Getting attention": this many OTHER accounts opened or kept it in the last week. */
export const NEARLY_GONE_WATCHERS = 3;

/** One tracked deal as the collector needs it. Built by the server from Batch 5's loadTrackedDeals. */
export interface TrackedForAlerts {
  /** B5's key: 'd-<deal id>' or 'l-<row id>'. The dedupe key, never a URL. */
  key: string;
  stage: string;
  kind: 'sale' | 'rent';
  opened: boolean;
  /** Only when opened (the caller applies B5's address rule; this re-checks). */
  address: string | null;
  town: string | null;
  type: string | null;
  dealId: string | null;
  checkedListingId: string | null;
  /** When the member started tracking it at this stage: nothing before this alerts. */
  trackedSince: string;
  /** The pipeline row's own history. */
  pipelineHistory: readonly PriceHistoryEntry[] | null;
  /** The row's stored figures, for the figure at a new price when there is no marketplace deal. */
  pipelineDeal: { kind: string; askingPrice?: number; advertisedRentPcm?: number; grossYieldPct?: number; monthlyMargin?: number } | null;
  deal: {
    status: string;
    priceAmount: number | null;
    pricePeriod: string | null;
    /** The card's headline figure at the CURRENT price (figureLine), or null. */
    figure: string | null;
    liveSince: string | null;
    retiredReason: string | null;
    retiredAt: string | null;
    history: readonly PriceHistoryEntry[];
    revivedAt: string | null;
    revivedFrom: string | null;
  } | null;
}

export interface AlertInsert {
  user_id: string;
  alert_type: AlertType;
  source: 'pipeline' | 'marketplace';
  deal_key: string;
  deal_id: string | null;
  checked_listing_id: string | null;
  event_at: string;
  payload: AlertPayload;
}

/** What this member has already been alerted about, from deal_alerts (any state). */
export interface AlertedBefore {
  /** Lowest new price any price_drop alert for this deal carried. */
  lowestDrop: ReadonlyMap<string, number>;
  /** Latest back_on_market event per deal. */
  lastBack: ReadonlyMap<string, number>;
  /** Latest gone alert per deal, and what it said. */
  lastGone?: ReadonlyMap<string, { at: number; status: string }>;
}

function pipelineFigure(d: TrackedForAlerts['pipelineDeal'], amount: number): string | null {
  if (!d) return null;
  if (d.kind === 'purchase' && d.askingPrice === amount && typeof d.grossYieldPct === 'number') return `${d.grossYieldPct.toFixed(1)}% gross yield`;
  if (d.kind === 'rent-to-rent' && d.advertisedRentPcm === amount && typeof d.monthlyMargin === 'number') return `£${Math.round(d.monthlyMargin).toLocaleString('en-GB')}/mo margin`;
  return null;
}

/**
 * Every alert this member's tracked deals have earned since they started
 * tracking them (and within ALERT_MAX_AGE_MS). The unique key on deal_alerts
 * (user, type, deal, event time) makes writing the same one twice a no-op.
 *
 *   price_drop      a recorded drop, below any price already alerted (so a
 *                   feed/page flip-flop cannot alert twice), not a relabel.
 *                   The figure is the one computed at that very price, else
 *                   none: never a stale number.
 *   gone            it went under offer / sold / let agreed / off the market.
 *   back_on_market  it came back from one of those AND a page read confirmed
 *                   it live (live_since after the revival); once a fortnight.
 *   nearly_gone     3+ other accounts opened or kept it in the last week.
 * Passed and Secured deals earn nothing.
 */
export function alertsFor(userId: string, items: readonly TrackedForAlerts[], watchers: ReadonlyMap<string, number>, before: AlertedBefore, now: Date = new Date()): AlertInsert[] {
  const out: AlertInsert[] = [];
  for (const it of items) {
    if (QUIET_STAGES.has(it.stage)) continue;
    const floor = Math.max(time(it.trackedSince), now.getTime() - ALERT_MAX_AGE_MS);
    const source: AlertInsert['source'] = it.dealId ? 'marketplace' : 'pipeline';
    const base = { user_id: userId, source, deal_key: it.key, deal_id: it.dealId, checked_listing_id: it.checkedListingId };
    const common: AlertPayload = { kind: it.kind, opened: it.opened, address: it.opened ? it.address : null, town: it.town, type: it.type, stage: it.stage };
    const push = (alert_type: AlertType, event_at: string, payload: AlertPayload) => out.push({ ...base, alert_type, event_at, payload: { ...common, ...payload } });

    // ── Price drops: the marketplace record when there is one (always pcm for rent, re-screened), else the row's ──
    const history = it.deal ? it.deal.history : it.pipelineHistory ?? [];
    let lowest = before.lowestDrop.get(it.key) ?? Infinity;
    for (const e of [...history].sort((a, b) => time(a.at) - time(b.at))) {
      // notified: the pre-Batch-6 re-check already emailed it. Never told twice.
      if (e.notified || time(e.at) <= floor || e.previousAmount === null || e.amount === null) continue;
      if (!(e.amount < e.previousAmount) || !plausiblePriceChange(e.previousAmount, e.amount)) continue;
      if (!(e.amount < lowest)) continue;
      lowest = e.amount;
      const period = it.deal?.pricePeriod ?? e.period ?? 'total';
      const figure = it.deal ? (it.deal.priceAmount === e.amount ? it.deal.figure : null) : pipelineFigure(it.pipelineDeal, e.amount);
      push('price_drop', e.at, { oldAmount: e.previousAmount, newAmount: e.amount, period, figure });
    }

    // ── Gone: once per going. A listing the feed keeps reviving and its page keeps
    // retiring would otherwise say "gone" every day; the same news is not told
    // again unless it came back (and was told so) in between. ──
    let told = before.lastGone?.get(it.key) ?? null;
    const backSince = (at: number) => (before.lastBack.get(it.key) ?? -Infinity) > at;
    const gone = (at: string, status: string) => {
      if (told && told.status === status && !backSince(told.at)) return;
      push('gone', at, { status });
      told = { at: time(at), status };
    };
    const goneEvents: { at: string; status: string }[] = [];
    if (it.deal?.retiredReason && GONE_REASONS.has(it.deal.retiredReason) && it.deal.status === 'retired' && it.deal.retiredAt && time(it.deal.retiredAt) > floor) goneEvents.push({ at: it.deal.retiredAt, status: it.deal.retiredReason });
    for (const e of it.pipelineHistory ?? []) if (!e.notified && time(e.at) > floor && e.status && GONE_REASONS.has(e.status)) goneEvents.push({ at: e.at, status: e.status });
    for (const g of goneEvents.sort((a, b) => time(a.at) - time(b.at))) gone(g.at, g.status);

    // ── Back on the market ──
    const lastBack = before.lastBack.get(it.key) ?? -Infinity;
    const d = it.deal;
    if (d?.revivedAt && d.revivedFrom && GONE_REASONS.has(d.revivedFrom) && d.status === 'live' && time(d.liveSince) >= time(d.revivedAt) && time(d.revivedAt) > floor && time(d.revivedAt) - lastBack >= BACK_COOLDOWN_MS) {
      push('back_on_market', d.revivedAt, { previousStatus: d.revivedFrom, newAmount: d.priceAmount, period: d.pricePeriod });
    }
    for (const e of it.pipelineHistory ?? []) {
      if (!e.notified && time(e.at) > floor && e.status === 'available' && e.previousStatus && GONE_REASONS.has(e.previousStatus) && time(e.at) - lastBack >= BACK_COOLDOWN_MS) {
        push('back_on_market', e.at, { previousStatus: e.previousStatus, newAmount: e.amount, period: e.period });
      }
    }

    // ── Getting attention: once per member per deal per time live ──
    const n = it.dealId ? watchers.get(it.dealId) ?? 0 : 0;
    if (d && d.status === 'live' && d.liveSince && n >= NEARLY_GONE_WATCHERS) push('nearly_gone', d.liveSince, { watchers: n });
  }
  return out;
}
