/**
 * Batch 22, Part B: "I checked N live deals …" — what the day's choice read
 * (profile_today_lists.choice), worded for the path that chose it. Never "all"
 * or "every": a read that hit its limit says "the N most profitable".
 *
 * Pure: no network, no database, no server-only.
 */

export interface ChoiceTally {
  /** Distinct live deals visible to the member that the choice read (after passes; less kept, opened, earlier-shown). */
  checked: number;
  /** Tailored: how many of them meet every must-have. */
  meeting: number | null;
  /** A pool read hit its limit. */
  capped: boolean;
  /** The nearby-areas read ran. */
  nearby: boolean;
  /** How many of them the member's own search found just now. */
  finds: number;
}

export function parseChoiceTally(raw: unknown): ChoiceTally | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const checked = n(r.checked);
  if (checked === null) return null;
  return { checked, meeting: n(r.meeting), capped: r.capped === true, nearby: r.nearby === true, finds: n(r.finds) ?? 0 };
}

const deals = (n: number) => `${n.toLocaleString('en-GB')} live deal${n === 1 ? '' : 's'}`;

/** The "I checked" line; null when nothing was checked (the no-match block speaks instead). */
export function checkedLine(t: ChoiceTally, opts: { tailored: boolean; smallCount: number }): string | null {
  if (t.checked <= 0) return null;
  const what = t.capped ? `the ${t.checked.toLocaleString('en-GB')} most profitable live deals` : deals(t.checked);
  const found = t.finds > 0 ? `, including ${t.finds} I found for you just now` : '';
  if (opts.tailored && t.meeting !== null) {
    return `I checked ${what} across the UK against your must-haves${found}: ${t.meeting.toLocaleString('en-GB')} meet them.`;
  }
  if (t.checked < opts.smallCount) return `I checked ${what} in your areas${t.nearby ? ' and nearby' : ''}${found}.`;
  return `I checked ${what} in your areas and budget${t.nearby ? ', and nearby' : ''}${found} — this is the best fit.`;
}
