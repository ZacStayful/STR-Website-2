/**
 * "Your week", the Monday email (Part D): up to three sections, each shown
 * only when it has something true to say.
 *
 *   1. Deals you missed   deals that matched the member's goals, that they
 *                         never opened, kept, passed or were sent as a pick,
 *                         and that went sold / under offer / let agreed since
 *                         their last Your week. Up to five, best profit first,
 *                         then the real total. A free account is only ever
 *                         LISTED deals it could have seen; the ones that went
 *                         while still in early access are only counted, in one
 *                         line with a link to /upgrade.
 *   2. Your deals         a recap of what moved on the deals they track,
 *                         including what the daily emails already said.
 *   3. Your areas         the saved-area trend changes, unchanged.
 *
 * Section 2 never sends the email on its own. No section, no email.
 *
 * Pure: no network, no database, no server-only.
 */
import { describeType, headlineFigure, type DealCard, type DealFilters } from '../marketplace/grid.ts';
import { areaChangeLine, type AlertChange } from '../market/alerts.ts';
import { manageNotificationsUrl } from '../url.ts';
import { placeOf, type Item, type Link, type Message, type Section, type Unsubscribe } from './message.ts';
import { describeChange, type PriceHistoryEntry } from '../listing/recheck.ts';
import { plausiblePriceChange } from './alerts.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** How many missed deals are listed; the rest are counted. */
export const MISSED_LISTED = 5;

export type WentReason = 'sold' | 'under_offer' | 'let_agreed';
export const WENT_REASONS: readonly WentReason[] = ['sold', 'under_offer', 'let_agreed'];

/** A deal that went: the grid's public columns plus when and how it went. Nothing private. */
export type WentDeal = Pick<DealCard, 'id' | 'kind' | 'postcode_area' | 'town' | 'bedrooms' | 'price_amount' | 'price_period' | 'raw_type' | 'tenure' | 'annual_profit' | 'uplift_pct' | 'listed_date' | 'first_seen_at' | 'live_since'> & {
  retired_reason: WentReason;
  retired_at: string;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const time = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Whether a deal matches a member's filters: the same tests the grid's query applies (queries.ts dealsQuery). */
export function matchesFilters(d: Pick<WentDeal, 'kind' | 'postcode_area' | 'bedrooms' | 'price_amount' | 'annual_profit' | 'uplift_pct'>, f: DealFilters): boolean {
  if (f.kind !== 'both' && d.kind !== f.kind) return false;
  if (f.areas.length > 0 && !(d.postcode_area && f.areas.includes(d.postcode_area))) return false;
  if (f.beds === '4+') {
    if (!(d.bedrooms !== null && d.bedrooms >= 4)) return false;
  } else if (f.beds !== 'any' && d.bedrooms !== Number(f.beds)) return false;
  const price = num(d.price_amount);
  if (f.minPrice !== null && !(price !== null && price >= f.minPrice)) return false;
  if (f.maxPrice !== null && !(price !== null && price <= f.maxPrice)) return false;
  const profit = num(d.annual_profit);
  if (f.minProfit !== null && !(profit !== null && profit >= f.minProfit)) return false;
  const uplift = num(d.uplift_pct);
  if (f.minUplift !== null && f.kind === 'sale' && !(uplift !== null && uplift >= f.minUplift)) return false;
  return true;
}

/**
 * Whether a free account could ever have seen this deal: it had been live for
 * the whole early-access window before it went. A deal with no live_since is
 * treated as never visible (as dealVisible treats a live one).
 */
export function wasVisibleToFree(d: Pick<WentDeal, 'live_since' | 'retired_at'>, delayHours: number): boolean {
  if (!(delayHours > 0)) return true;
  const live = time(d.live_since);
  const went = time(d.retired_at);
  if (live === null || went === null) return false;
  return live + delayHours * HOUR_MS <= went;
}

export interface MissedInput {
  deals: readonly WentDeal[];
  filters: DealFilters;
  /** Deal ids the member opened, kept, passed or was sent as a pick: never "missed". */
  seen: ReadonlySet<string>;
  /** Only deals that went at or after this. */
  since: string;
  /** Null for an account that has paid; else the free early-access delay in hours. */
  freeDelayHours: number | null;
}

export interface Missed {
  /** Every matching deal that went, early access included. */
  total: number;
  /** What may be listed, best profit first, at most MISSED_LISTED. */
  listed: WentDeal[];
  /** Of the total, how many went while still in early access (free accounts only; 0 for paid). */
  earlyAccess: number;
}

export function missedFor(input: MissedInput): Missed {
  const since = time(input.since) ?? 0;
  const matching = input.deals.filter((d) => (time(d.retired_at) ?? 0) >= since && WENT_REASONS.includes(d.retired_reason) && !input.seen.has(d.id) && matchesFilters(d, input.filters));
  const free = input.freeDelayHours;
  const visible = free === null ? matching : matching.filter((d) => wasVisibleToFree(d, free));
  const listed = [...visible].sort((a, b) => (num(b.annual_profit) ?? -Infinity) - (num(a.annual_profit) ?? -Infinity)).slice(0, MISSED_LISTED);
  return { total: matching.length, listed, earlyAccess: matching.length - visible.length };
}

const WENT_WORDS: Record<WentReason, string> = { sold: 'Sold', under_offer: 'Under offer', let_agreed: 'Let agreed' };

/**
 * How fast it went, as an upper bound: we know when WE saw it go, not the
 * hour it went. "Under offer within 4 days of listing" when the portal gave a
 * listing date, else "…of reaching Stayful" (when we first saw it).
 */
export function speedLine(d: Pick<WentDeal, 'retired_reason' | 'retired_at' | 'listed_date' | 'first_seen_at'>): string {
  const listed = time(d.listed_date);
  const start = listed ?? time(d.first_seen_at);
  const went = time(d.retired_at);
  const word = WENT_WORDS[d.retired_reason];
  if (start === null || went === null || went < start) return word;
  const days = Math.max(1, Math.ceil((went - start) / DAY_MS));
  return `${word} within ${days} day${days === 1 ? '' : 's'} of ${listed !== null ? 'listing' : 'reaching Stayful'}`;
}

function missedItem(d: WentDeal): Item {
  const f = headlineFigure({ kind: d.kind, annual_profit: num(d.annual_profit), uplift_pct: num(d.uplift_pct) });
  const title = f.big === '—' ? (d.kind === 'rent' ? 'Rent-to-rent' : 'To buy') : `${f.big} · ${f.small}`;
  const where = [placeOf(d), describeType({ bedrooms: d.bedrooms, raw_type: d.raw_type, tenure: d.tenure })].filter(Boolean).join(' · ');
  return { title, lines: [where, speedLine(d)].filter((x) => x.length > 0), link: null };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function windowWords(since: string, now: Date): string {
  const days = Math.round((now.getTime() - (time(since) ?? now.getTime())) / DAY_MS);
  return days <= 8 ? 'this week' : `in the last ${days} days`;
}

function delayWords(hours: number): string {
  return hours % 24 === 0 ? plural(hours / 24, 'day') : plural(hours, 'hour');
}

export function missedSection(m: Missed, opts: { siteUrl: string; since: string; now: Date; freeDelayHours: number | null }): Section | null {
  if (m.total === 0) return null;
  const base = opts.siteUrl.replace(/\/$/, '');
  const blocks: Section['blocks'] = [];
  if (m.listed.length > 0) blocks.push({ type: 'items', items: m.listed.map(missedItem) });
  blocks.push({ type: 'text', text: `${plural(m.total, 'deal')} matching you went ${windowWords(opts.since, opts.now)}.`, tone: 'strong' });
  if (opts.freeDelayHours !== null && m.earlyAccess > 0) {
    blocks.push({ type: 'text', text: `${m.earlyAccess} of these ${m.earlyAccess === 1 ? 'was' : 'were'} in early access — paid members saw ${m.earlyAccess === 1 ? 'it' : 'them'} ${delayWords(opts.freeDelayHours)} before you could.`, tone: 'callout' });
    blocks.push({ type: 'buttons', links: [{ label: 'See deals first', url: `${base}/upgrade`, primary: true }] });
  }
  blocks.push({ type: 'buttons', links: [{ label: 'Open Today', url: `${base}/today`, primary: opts.freeDelayHours === null || m.earlyAccess === 0 }] });
  return { key: 'missed', title: 'Deals you missed', blocks };
}

/** One line of the recap: which deal (never an address it may not show) and what moved. */
export interface RecapItem {
  place: string;
  summary: string;
  link: Link;
}

/** One tracked deal, as the recap needs it. `place` is already address-safe (B5's opened rule). */
export interface RecapSource {
  place: string;
  stage: string;
  link: Link;
  /** The pipeline row's own history, when the deal has a row: preferred, it is the member's own record. */
  pipelineHistory: readonly PriceHistoryEntry[] | null;
  /** The marketplace deal's history, when it is one. */
  dealHistory: readonly PriceHistoryEntry[] | null;
  /** How the marketplace deal went, when it has. */
  retired: { reason: string; at: string } | null;
  revivedAt: string | null;
}

const RETIRED_WORDS: Record<string, string> = { sold: 'now sold', under_offer: 'now under offer', let_agreed: 'now let agreed', removed: 'no longer listed' };

/**
 * What moved on each tracked deal since `since`, in the recheck's own words
 * ("price down from £250,000 to £240,000 (-4.0%)"). Passed deals are left
 * out; a deal with nothing since is left out; a re-labelled rent is not a
 * price change.
 */
export function recapItems(sources: readonly RecapSource[], since: string): RecapItem[] {
  const from = time(since) ?? 0;
  const out: RecapItem[] = [];
  for (const s of sources) {
    if (s.stage === 'passed') continue;
    const history = (s.pipelineHistory && s.pipelineHistory.length > 0 ? s.pipelineHistory : s.dealHistory) ?? [];
    const moves: string[] = [];
    for (const e of history) {
      if ((time(e.at) ?? 0) < from) continue;
      const priceOk = e.previousAmount === null || plausiblePriceChange(e.previousAmount, e.amount);
      const entry = priceOk ? e : { ...e, previousAmount: null };
      const words = describeChange(entry);
      if (words) moves.push(words);
    }
    const saidStatus = moves.some((m) => /now |no longer|back on the market/.test(m));
    if (!saidStatus && s.retired && (time(s.retired.at) ?? 0) >= from && RETIRED_WORDS[s.retired.reason]) moves.push(RETIRED_WORDS[s.retired.reason]);
    if (!saidStatus && s.revivedAt && (time(s.revivedAt) ?? 0) >= from && !(s.retired && (time(s.retired.at) ?? 0) > (time(s.revivedAt) ?? 0))) moves.push('back on the market');
    if (moves.length === 0) continue;
    const summary = moves.join('; ');
    out.push({ place: s.place, summary: summary[0].toUpperCase() + summary.slice(1), link: s.link });
  }
  return out;
}

export function recapSection(items: readonly RecapItem[]): Section | null {
  if (items.length === 0) return null;
  return { key: 'recap', title: 'Your deals this week', blocks: [{ type: 'items', items: items.map((i) => ({ title: i.place, lines: [i.summary], link: i.link })) }] };
}

export function areasSection(changes: readonly AlertChange[], siteUrl: string): Section | null {
  if (changes.length === 0) return null;
  const base = siteUrl.replace(/\/$/, '');
  return {
    key: 'areas',
    title: 'Your areas',
    blocks: [
      { type: 'items', items: changes.map((c) => ({ title: `${c.name} (${c.code})`, lines: [areaChangeLine(c).replace(/^.*?\): /, '')], link: { label: 'Open the area', url: `${base}/markets/${c.code.toLowerCase()}` } })) },
      { type: 'buttons', links: [{ label: 'Open the Market Explorer', url: `${base}/markets` }] },
    ],
  };
}

export interface WeekInput {
  siteUrl: string;
  now: Date;
  since: string;
  /** Section 1, or null when switched off or the member has no goals. */
  missed: Missed | null;
  freeDelayHours: number | null;
  /** Section 2, or null when "Changes on deals I'm tracking" is off. */
  recap: readonly RecapItem[] | null;
  /** Section 3, or null when "Weekly area alerts" is off. */
  areas: readonly AlertChange[] | null;
  unsubscribe: Unsubscribe | null;
}

export interface BuiltWeek {
  message: Message;
  sections: { missed: number; missedListed: string[]; earlyAccess: number; recap: number; areas: number };
}

export function buildYourWeek(input: WeekInput): BuiltWeek | null {
  const missed = input.missed ? missedSection(input.missed, { siteUrl: input.siteUrl, since: input.since, now: input.now, freeDelayHours: input.freeDelayHours }) : null;
  const areas = input.areas ? areasSection(input.areas, input.siteUrl) : null;
  // The recap rides along; it never sends the email on its own.
  if (!missed && !areas) return null;
  const recap = input.recap ? recapSection(input.recap) : null;
  const sections = [missed, recap, areas].filter((s): s is Section => s !== null);
  const parts: string[] = [];
  if (missed && input.missed) parts.push(`${plural(input.missed.total, 'deal')} matching you went`);
  if (areas && input.areas) parts.push(input.areas.length === 1 ? `${input.areas[0].name} changed` : `${input.areas.length} of your areas changed`);
  if (recap && input.recap) parts.push(`${input.recap.length} of your deals moved`);
  return {
    message: {
      kind: 'your_week',
      subject: `Your week: ${parts.slice(0, 2).join(' · ')}`,
      eyebrow: 'Stayful · Your week',
      sections,
      reason: 'You get this on Mondays because weekly emails are on.',
      manageUrl: manageNotificationsUrl(input.siteUrl.replace(/\/$/, '')),
      unsubscribe: input.unsubscribe,
    },
    sections: {
      missed: input.missed && missed ? input.missed.total : 0,
      missedListed: input.missed && missed ? input.missed.listed.map((d) => d.id) : [],
      earlyAccess: input.missed && missed && input.freeDelayHours !== null ? input.missed.earlyAccess : 0,
      recap: recap && input.recap ? input.recap.length : 0,
      areas: areas && input.areas ? input.areas.length : 0,
    },
  };
}
