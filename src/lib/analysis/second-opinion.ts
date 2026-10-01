/**
 * Batch 22, Part H: the Deep report's side-by-side. Our month-by-month
 * short-let revenue beside PMI's, and PMI's comparables laid out like ours.
 *
 * Pure: no network, no database, no server-only.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "2025-03", "2025-03-01", "March", "Mar" → 2 (March); null when it can't be read. */
export function monthIndex(label: string): number | null {
  const iso = /^\d{4}-(\d{1,2})/.exec(label.trim());
  if (iso) {
    const m = Number(iso[1]) - 1;
    return m >= 0 && m < 12 ? m : null;
  }
  const word = label.trim().toLowerCase();
  const i = NAMES.findIndex((n) => n === word || n.slice(0, 3) === word.slice(0, 3));
  return i >= 0 ? i : null;
}

export interface MonthRow {
  month: string;
  ours: number | null;
  pmi: number | null;
}

/** Twelve rows, January first: ours and PMI's for each month (null where a side has none). */
export function monthRows(ours: readonly number[] | null | undefined, pmi: readonly { month: string; revenue: number }[] | null | undefined): MonthRow[] {
  const byMonth = new Map<number, number>();
  for (const m of pmi ?? []) {
    const i = monthIndex(m.month);
    if (i !== null && Number.isFinite(m.revenue) && !byMonth.has(i)) byMonth.set(i, Math.round(m.revenue));
  }
  return MONTHS.map((month, i) => ({
    month,
    ours: ours && Number.isFinite(ours[i]) ? Math.round(ours[i]) : null,
    pmi: byMonth.get(i) ?? null,
  }));
}

export interface ComparableRow {
  title: string;
  annual: number | null;
  nightly: number | null;
  occupancyPct: number | null;
  rating: number | null;
  distance: string | null;
  url: string | null;
}

/** PMI's comparables, nearest first, at most `max`, in our comparables' terms. */
export function comparableRows(comps: readonly { title: string; revenue: number | null; adr: number | null; occupancy: number | null; rating: number | null; url: string | null; distanceM: number | null }[] | null | undefined, max = 6): ComparableRow[] {
  return [...(comps ?? [])]
    .sort((a, b) => (a.distanceM ?? Number.POSITIVE_INFINITY) - (b.distanceM ?? Number.POSITIVE_INFINITY))
    .slice(0, max)
    .map((c) => ({
      title: c.title || 'Listing',
      annual: c.revenue === null ? null : Math.round(c.revenue),
      nightly: c.adr === null ? null : Math.round(c.adr),
      occupancyPct: c.occupancy === null ? null : Math.round((c.occupancy <= 1 ? c.occupancy * 100 : c.occupancy) * 10) / 10,
      rating: c.rating,
      distance: c.distanceM === null ? null : c.distanceM < 1000 ? `${Math.round(c.distanceM)} m` : `${(c.distanceM / 1609.34).toFixed(1)} miles`,
      url: c.url && /^https:\/\//.test(c.url) ? c.url : null,
    }));
}
