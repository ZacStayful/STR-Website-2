/**
 * Batch 22: what a day's choice read, and the answers it was chosen with.
 *
 *   poolTally        wraps the pool read: the distinct live deals visible to
 *                    the member that the choice read, less what is excluded
 *                    (kept, passed, opened, shown before). A read with the
 *                    budget lifted (the near-miss search) is not counted: those
 *                    deals are outside the member's budget. A read of areas
 *                    outside the first read's is "nearby".
 *   answersFingerprint  the answers a list was chosen with: a re-choose with
 *                    the same fingerprint changes nothing (bug 7), and one
 *                    from older answers than the stored list's is refused (bug 8).
 *
 * Stored in profile_today_lists.choice: {checked, meeting, capped, nearby,
 * finds, fp, answeredAt}. Pure: no network, no database, no server-only.
 */
import type { DealFilters } from '../marketplace/grid.ts';

export interface StoredChoice {
  checked: number;
  meeting: number | null;
  capped: boolean;
  nearby: boolean;
  finds: number;
  fp: string | null;
  answeredAt: string | null;
}

type PoolFn<R extends { id: string }> = (filters: DealFilters, limit: number) => Promise<R[]>;

export function poolTally<R extends { id: string }>(exclude: ReadonlySet<string>) {
  const seen = new Set<string>();
  const firstByTypes = new Map<string, DealFilters>();
  let ownAreas: Set<string> | null = null;
  let capped = false;
  let nearby = false;
  const wrap = (pool: PoolFn<R>): PoolFn<R> => async (filters, limit) => {
    const rows = await pool(filters, limit);
    const key = JSON.stringify([...(filters.types ?? [])].sort());
    const first = firstByTypes.get(key);
    if (!first) firstByTypes.set(key, filters);
    if (ownAreas === null && filters.areas.length > 0) ownAreas = new Set(filters.areas);
    const outside = ownAreas !== null && filters.areas.some((a) => !ownAreas!.has(a));
    const loose = first !== undefined && (first.minPrice !== null || first.maxPrice !== null) && filters.minPrice === null && filters.maxPrice === null && !outside;
    if (loose) return rows;
    if (outside) nearby = true;
    if (rows.length >= limit) capped = true;
    for (const r of rows) if (!exclude.has(r.id)) seen.add(r.id);
    return rows;
  };
  return {
    wrap,
    result: (meeting: number | null, extraCapped = false): Omit<StoredChoice, 'fp' | 'answeredAt' | 'finds'> => ({ checked: seen.size, meeting, capped: capped || extraCapped, nearby }),
  };
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** FNV-1a, 32-bit, hex: a short, stable fingerprint of the answers (not a security hash). */
export function answersFingerprint(input: { goals: unknown; savedAreas: readonly string[]; modes?: unknown; answers?: unknown }): string {
  const text = stable({ goals: input.goals ?? null, areas: [...input.savedAreas].sort(), modes: input.modes ?? null, answers: input.answers ?? null });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function parseStoredChoice(raw: unknown): StoredChoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  return {
    checked: n(r.checked) ?? 0,
    meeting: n(r.meeting),
    capped: r.capped === true,
    nearby: r.nearby === true,
    finds: n(r.finds) ?? 0,
    fp: typeof r.fp === 'string' ? r.fp : null,
    answeredAt: typeof r.answeredAt === 'string' ? r.answeredAt : null,
  };
}

/**
 * Should a re-choose go ahead? Not when the list was chosen with these very
 * answers (a no-op re-choose would still rotate a near-miss card), and not
 * when the stored list was chosen from answers newer than this request's.
 */
export function rechooseAllowed(stored: StoredChoice | null, fp: string, answeredAt: string | null): 'go' | 'same' | 'stale' {
  if (stored?.fp && stored.fp === fp) return 'same';
  if (stored?.answeredAt && answeredAt) {
    const a = Date.parse(stored.answeredAt);
    const b = Date.parse(answeredAt);
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) return 'stale';
  }
  return 'go';
}
