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
const TIMEOUT_MS = 20_000;

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

/** The application count in a PlanIt response, or null when the shape is wrong. */
export function parsePlanItTotal(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const total = (body as { total?: unknown }).total;
  return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? Math.round(total) : null;
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

/** Large applications started in the window within `radiusKm` of a point; null on any failure. */
export async function countLargeApplications(lat: number, lng: number, radiusKm: number, window: PlanItWindow): Promise<number | null> {
  try {
    const res = await fetch(planItUrl(lat, lng, radiusKm, window), {
      headers: { accept: 'application/json', 'user-agent': 'Stayful Market Explorer (planning signals)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`[planit] HTTP ${res.status} for ${lat.toFixed(3)},${lng.toFixed(3)}`);
      return null;
    }
    return parsePlanItTotal(await res.json());
  } catch (err) {
    console.warn('[planit] fetch failed:', (err as Error)?.message ?? err);
    return null;
  }
}
