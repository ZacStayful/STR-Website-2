/**
 * Batch 22e, Part C: "properties scanned", one definition.
 *
 * Every job that screens listings (the 05:00 sweep, the daily picks' broker
 * queries, the low-entry search, and through absorbListings demand sourcing
 * and member searches too) writes each listing once into sourced_listings,
 * keyed by its canonical URL. The insert ignores a listing already there, so
 * its first_seen_at is set the first time any job screens it and never moves.
 *
 * listing_scan_days holds, per UK day, postcode area and kind (sale / rent),
 * how many listings were first screened that day. It is RECOUNTED from
 * sourced_listings (public.record_listing_scan_days), never added to: a job
 * run twice, or a listing re-screened on three days, cannot move a count.
 *
 * A member's figure (memberScanTotal below, scanned-server.ts for the reads):
 *
 *   scope     the union over their live profiles of the postcode areas the
 *             Batch 14 matcher keeps them to (wantsFor().areas; none means
 *             every area: "anywhere" and "near me + the best elsewhere") and
 *             the kinds their deal types search (Batch 17 kindsOf)
 *   J         the UK day they joined
 *   baseline  listings in scope first screened on or before J and still seen
 *             on or after J: what was live when they joined. Stored once
 *             (member_scan_baselines) after J has ended
 *   new       Σ listing_scan_days in scope for days after J
 *   total     max(baseline, the signup reveal's "checked") + new
 *
 * baseline and new cannot overlap (first screened ≤ J against > J). The
 * reveal's checked deals are live marketplace deals, so already rows of the
 * baseline; the max only matters if the reveal looked wider. Start again
 * (Batch 22d) does not reset it: it is an account total since joining.
 * Batch 23b's nightly snapshot reads this too; there is no second "scanned".
 *
 * Pure: no network, no database, no server-only.
 */
import { addDays, ukDay } from '../activity/week.ts';

export type ScanKind = 'sale' | 'rent';

/** The days a job recounts when it finishes: yesterday and today (UK), so listings found late yesterday by another job are counted by the next morning's run. */
export function scanDaysToRecount(now: Date): string[] {
  const today = ukDay(now);
  return [addDays(today, -1), today];
}

/** One listing as stored: when it was first screened, where, which kind. */
export interface ScreenedListing {
  url: string;
  firstSeenAt: Date;
  area: string | null;
  kind: string;
}

/** A row of listing_scan_days. */
export interface ScanDayRow {
  day: string;
  area: string;
  kind: ScanKind;
  newListings: number;
}

const rowKey = (day: string, area: string, kind: string) => `${day}|${area}|${kind}`;

/**
 * What record_listing_scan_days computes for `days`: listings first screened
 * on each of those UK days, by area and kind. Mirrors the SQL so the rules are
 * tested here.
 */
export function recountScanDays(listings: readonly ScreenedListing[], days: readonly string[]): ScanDayRow[] {
  const wanted = new Set(days);
  const counts = new Map<string, ScanDayRow>();
  for (const l of listings) {
    if (!l.area || (l.kind !== 'sale' && l.kind !== 'rent')) continue;
    const day = ukDay(l.firstSeenAt);
    if (!wanted.has(day)) continue;
    const area = l.area.toUpperCase();
    const key = rowKey(day, area, l.kind);
    const row = counts.get(key) ?? { day, area, kind: l.kind, newListings: 0 };
    row.newListings += 1;
    counts.set(key, row);
  }
  return [...counts.values()];
}

/** The table after an upsert of a recount: each recounted day is replaced, never added to; other days are left alone. */
export function applyRecount(table: readonly ScanDayRow[], days: readonly string[], recount: readonly ScanDayRow[]): ScanDayRow[] {
  const replaced = new Set(days);
  return [...table.filter((r) => !replaced.has(r.day)), ...recount];
}

/** A member's scope: areas null means every area. */
export interface ScanScope {
  areas: ReadonlySet<string> | null;
  kinds: ReadonlySet<ScanKind>;
}

export function inScope(scope: ScanScope, area: string, kind: string): boolean {
  if (kind !== 'sale' && kind !== 'rent') return false;
  if (!scope.kinds.has(kind)) return false;
  return scope.areas === null || scope.areas.has(area.toUpperCase());
}

/** New listings screened in scope on days after the join day. */
export function newSinceJoining(rows: readonly ScanDayRow[], scope: ScanScope, joinDay: string): number {
  let n = 0;
  for (const r of rows) if (r.day > joinDay && inScope(scope, r.area, r.kind)) n += r.newListings;
  return n;
}

export interface ScanTotal {
  baseline: number;
  newSince: number;
  total: number;
}

/** max(baseline, reveal checked) + new. Negative or missing parts read as 0, so the sum is never NaN. */
export function memberScanTotal(baseline: number | null | undefined, revealChecked: number | null | undefined, newSince: number | null | undefined): ScanTotal {
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const b = Math.max(n(baseline), n(revealChecked));
  const s = n(newSince);
  return { baseline: b, newSince: s, total: b + s };
}
