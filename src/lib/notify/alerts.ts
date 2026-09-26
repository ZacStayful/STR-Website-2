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
 *     marketplace deal share a canonical URL) is told once.
 *   - Price drops collapse: first price → price now. If "now" is not lower
 *     than where it started, there is no drop to tell.
 *   - A price drop on a deal that has since gone is not told; the "gone" is.
 *   - Of "gone" and "back on the market", only the latest is told.
 *   - Back on the market and "getting attention" need the deal live now.
 *
 * Pure: no network, no database, no server-only.
 */
import type { AlertType, ChangeInput } from './message.ts';

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
  canonical_url: string;
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

  // Group by deal (canonical URL): one stream per deal, whichever list it is on.
  const byUrl = new Map<string, AlertRow[]>();
  for (const r of live) byUrl.set(r.canonical_url, [...(byUrl.get(r.canonical_url) ?? []), r]);

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

/** Every alert id a list of settled changes stands for: what finishSend marks notified. */
export function alertIdsOf(changes: readonly { id: string; mergedIds?: string[] }[]): string[] {
  return changes.flatMap((c) => [c.id, ...(c.mergedIds ?? [])]);
}
