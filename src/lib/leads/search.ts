/**
 * Turning what a customer types into the search box, and the dates they
 * pick, into something safe and exact to query with.
 *
 * Pure module so it runs under `node --test`.
 */

const MAX_TERM = 100;

/**
 * A free-text search term, cleaned for PostgREST's `.or()` filter.
 *
 * The term is interpolated into a filter string of the form
 * `email.ilike.%term%,name.ilike.%term%`. In that syntax a comma starts a
 * new clause and parentheses group them, so a raw `,` or `(` from the search
 * box could add a filter of the caller's choosing. They are stripped, along
 * with the quote and backslash that change how a value is read and the
 * wildcards (`%`, `*`) that would let one term match everything.
 *
 * The owner filter is applied separately and cannot be affected by any of
 * this — this is about a search meaning what was typed, not about access.
 *
 * Returns null for a term with nothing left to search for.
 */
export function searchTerm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[,()"\\%*:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TERM)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** The PostgREST `.or()` expression for a cleaned term. */
export function searchFilter(term: string): string {
  const v = `%${term}%`;
  return ['email', 'name', 'address', 'postcode'].map((c) => `${c}.ilike.${v}`).join(',');
}

/** Minutes London is ahead of UTC at `at` (0 in winter, 60 in summer). */
function londonOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * The instant a UK calendar day starts, from a `YYYY-MM-DD` date input.
 *
 * Customers pick dates in UK time. Reading "12 Mar" as UTC midnight would,
 * during British Summer Time, file an enquiry made at 00:30 on 12 Jul under
 * 11 Jul — so the day is resolved in Europe/London. Clocks change at 01:00
 * UTC, never at midnight, so a UK midnight always exists exactly once.
 */
export function londonDayStart(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const guess = Date.UTC(y, mo - 1, d);
  const probe = new Date(guess);
  // Reject 2026-02-31 and friends rather than letting Date roll them over.
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return new Date(guess - londonOffsetMinutes(probe) * 60_000);
}

/**
 * `from`/`to` date inputs as an inclusive `[since, until]` range of instants.
 * "To 12 Mar" includes the whole of 12 Mar — up to the last millisecond
 * before 13 Mar starts in the UK.
 */
export function londonDateRange(from: string | null | undefined, to: string | null | undefined): { since: string | null; until: string | null } {
  const start = from ? londonDayStart(from) : null;
  let until: string | null = null;
  if (to) {
    const end = londonDayStart(to);
    if (end) {
      // Noon + 1 day lands inside the next UK day whatever the offset, and
      // taking that day's start avoids hand-computing a DST-length day.
      const next = new Date(end.getTime() + 36 * 3_600_000);
      const nextYmd = next.toISOString().slice(0, 10);
      const nextStart = londonDayStart(nextYmd);
      if (nextStart) until = new Date(nextStart.getTime() - 1).toISOString();
    }
  }
  return { since: start ? start.toISOString() : null, until };
}
