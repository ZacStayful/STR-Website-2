/**
 * PlanIt (planit.org.uk): the UK planning-application index. Free, no key.
 * Used to count large applications around an area's centre, the
 * "contractor projects" signal behind direct-booking potential.
 *
 *   GET /api/applics/json?lat=&lng=&krad=&start_date=&end_date=&app_size=Large&pg_sz=1
 *   → { total, records, from, to, secs_taken }
 *
 * Only `total` is read, so one small page per window is enough.
 */

const BASE = 'https://www.planit.org.uk/api/applics/json';
// PlanIt counts across a large radius can take 20–30 s for a big city; its
// own data source gives up at 45 s, so wait a little longer for that answer.
const TIMEOUT_MS = 50_000;

export interface PlanItWindow {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

/** The 12 months ending `now`, and the 12 before them. */
export function planningWindows(now: Date): { recent: PlanItWindow; prior: PlanItWindow } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (d: Date, months: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
  const end = day(now);
  const mid = day(shift(now, -12));
  const start = day(shift(now, -24));
  return { recent: { start: mid, end }, prior: { start, end: mid } };
}

/**
 * The application count in a PlanIt response, or null when the shape is
 * wrong. PlanIt answers `total: null` with an empty `records` list when
 * nothing matches, which is a count of zero, not a failure.
 */
export function parsePlanItTotal(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const { total, records } = body as { total?: unknown; records?: unknown };
  if (typeof total === 'number' && Number.isFinite(total) && total >= 0) return Math.round(total);
  if (total === null && Array.isArray(records) && records.length === 0) return 0;
  return null;
}

export function planItUrl(lat: number, lng: number, radiusKm: number, window: PlanItWindow): string {
  const u = new URL(BASE);
  u.searchParams.set('lat', lat.toFixed(5));
  u.searchParams.set('lng', lng.toFixed(5));
  u.searchParams.set('krad', String(radiusKm));
  u.searchParams.set('start_date', window.start);
  u.searchParams.set('end_date', window.end);
  u.searchParams.set('app_size', 'Large');
  u.searchParams.set('pg_sz', '1');
  return u.toString();
}

const RATE_LIMIT_PAUSE_MS = 6_000;
const RATE_LIMIT_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Large applications started in the window within `radiusKm` of a point;
 * null on any failure. A 429 is PlanIt asking for a pause, not a sign the
 * radius is too wide, so it waits and retries before giving up.
 */
export async function countLargeApplications(lat: number, lng: number, radiusKm: number, window: PlanItWindow): Promise<number | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(planItUrl(lat, lng, radiusKm, window), {
        headers: { accept: 'application/json', 'user-agent': 'Stayful Market Explorer (planning signals)' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
      if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        await sleep(RATE_LIMIT_PAUSE_MS * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        console.warn(`[planit] HTTP ${res.status} for ${lat.toFixed(3)},${lng.toFixed(3)} at ${radiusKm} km`);
        return null;
      }
      return parsePlanItTotal(await res.json());
    } catch (err) {
      console.warn('[planit] fetch failed:', (err as Error)?.message ?? err);
      return null;
    }
  }
}

export interface PlanningCounts {
  recent: number;
  prior: number;
  /** The radius the counts were taken at (halved from the request when PlanIt timed out). */
  radiusKm: number;
}

/**
 * Both windows for a point, fetched together. PlanIt's own data source
 * times out over a dense city at a wide radius, so the radius halves (down
 * to a quarter of the request) before giving up. Null when nothing worked.
 */
export async function countLargeApplicationsBothWindows(lat: number, lng: number, radiusKm: number, now: Date): Promise<PlanningCounts | null> {
  const w = planningWindows(now);
  for (const r of [radiusKm, radiusKm / 2, radiusKm / 4]) {
    const [recent, prior] = await Promise.all([
      countLargeApplications(lat, lng, r, w.recent),
      countLargeApplications(lat, lng, r, w.prior),
    ]);
    if (recent !== null && prior !== null) return { recent, prior, radiusKm: r };
  }
  return null;
}
