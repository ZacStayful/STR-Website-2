/**
 * Batch 22e: "This week" on Home, what Stayful Intelligence did for the
 * member over the last seven UK days, from tables that already hold it
 * (listing_scan_days, the Today lists, the emails that went, alert emails,
 * analyses). It never names an address: a deal is "a deal you're tracking in
 * Leeds (LS)", so nothing here can leak one the member has not opened.
 *
 * Pure: no network, no database, no server-only.
 */
import { addDays, ukDay } from '../activity/week.ts';
import type { FeedItem } from './types.ts';

export const FEED_DAYS = 7;
export const FEED_MAX = 8;

export interface FeedDay {
  day: string;
  screened: number;
  picked: number;
  emailed: number;
}

export interface FeedEvent {
  at: string;
  kind: 'price_drop' | 'back_on_market' | 'nearly_gone' | 'gone' | 'analysis' | 'report';
  /** The deal's postcode area, when it has one. */
  area: string | null;
  areaName: string | null;
  dealId: string | null;
}

/** The first UK day "this week" covers (today and the six before it). */
export function feedFrom(now: Date): string {
  return addDays(ukDay(now), -(FEED_DAYS - 1));
}

const n = (v: number) => v.toLocaleString('en-GB');
const plural = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;

export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

const where = (e: FeedEvent) => (e.area ? ` in ${e.areaName && e.areaName !== `${e.area} postcode area` ? `${e.areaName} (${e.area})` : e.area}` : '');

function eventText(e: FeedEvent): string {
  switch (e.kind) {
    case 'price_drop':
      return `Spotted a price drop on a deal you're tracking${where(e)}`;
    case 'back_on_market':
      return `A deal you're tracking${where(e)} came back on the market`;
    case 'nearly_gone':
      return `Warned you a deal you're tracking${where(e)} may be going soon`;
    case 'gone':
      return `Let you know a deal you're tracking${where(e)} has gone`;
    case 'analysis':
      return 'Finished a full analysis for you';
    case 'report':
      return 'Ran an Analyser report for you';
  }
}

function eventHref(e: FeedEvent): string {
  if (e.kind === 'analysis' || e.kind === 'report') return '/my-deals?tab=reports';
  return e.dealId ? `/deals/${encodeURIComponent(e.dealId)}` : '/my-deals';
}

/** Newest first, at most FEED_MAX: one line per day that had anything, and one per alert or analysis. */
export function buildFeed(days: readonly FeedDay[], events: readonly FeedEvent[], now: Date): FeedItem[] {
  const today = ukDay(now);
  const items: FeedItem[] = [];
  for (const d of days) {
    const parts: string[] = [];
    if (d.screened > 0) parts.push(`screened ${plural(d.screened, 'new listing', 'new listings')} in your areas`);
    if (d.picked > 0) parts.push(`picked ${plural(d.picked, 'deal', 'deals')} for you`);
    if (d.emailed > 0) parts.push(`emailed you ${plural(d.emailed, 'deal', 'deals')}`);
    if (parts.length === 0) continue;
    const text = parts.join(', ');
    items.push({
      at: `${d.day}T23:59:59Z`,
      text: `${dayLabel(d.day, today)}: ${text.charAt(0).toUpperCase()}${text.slice(1)}`,
      href: d.picked > 0 && d.day === today ? '/today' : '/deals',
      target: d.picked > 0 && d.day === today ? 'feed:today' : 'feed:day',
    });
  }
  for (const e of events) {
    if (!Number.isFinite(Date.parse(e.at))) continue;
    items.push({ at: e.at, text: `${dayLabel(ukDay(new Date(e.at)), today)}: ${eventText(e)}`, href: eventHref(e), target: `feed:${e.kind}` });
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, FEED_MAX);
}
