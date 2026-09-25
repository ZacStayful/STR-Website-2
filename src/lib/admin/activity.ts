/**
 * The high-intent list: members ranked by what they did in the last 30
 * days. Pure — the page loads the rows, this module counts, flags and
 * sorts them, so the rules are tested and the page is only a table.
 */

export const ACTIVITY_WINDOW_DAYS = 30;
/** Flagged as high intent at or above either of these in the window. */
export const HIGH_INTENT_OPENS = 10;
export const HIGH_INTENT_REPORTS = 5;

export interface MemberActivity {
  id: string;
  name: string | null;
  email: string | null;
  mobile: string | null;
  /** The subscription tier, or null for a free account. */
  planCode: string | null;
  /** Deal sheets the member chose to open (auto-opens from picks excluded). */
  dealOpens: number;
  /** Analyser reports run. */
  reports: number;
  /** Daily picks received. */
  picks: number;
  /** Debits in the window, in base pence; a team owner's figure includes their members. */
  creditSpentPence: number;
  /** The latest of last_seen_at and every activity timestamp in the window. */
  lastActiveAt: string | null;
}

export interface ActivityInput {
  profiles: { id: string; email: string | null; full_name: string | null; mobile: string | null; plan_code: string | null; last_seen_at: string | null }[];
  opens: { user_id: string; opened_at: string | null }[];
  reports: { user_id: string; created_at: string | null }[];
  picks: { user_id: string; sent_at: string | null }[];
  debits: { user_id: string; amount_pence: number | string | null; at: string | null }[];
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** The latest of several timestamps, ignoring blanks and junk. */
export function latestOf(...isos: (string | null | undefined)[]): string | null {
  let best: { iso: string; t: number } | null = null;
  for (const iso of isos) {
    const t = time(iso);
    if (t !== null && (best === null || t > best.t)) best = { iso: iso as string, t };
  }
  return best?.iso ?? null;
}

/** One row per profile, counting only what the window rows say. */
export function aggregateActivity(input: ActivityInput): MemberActivity[] {
  const opens = new Map<string, { n: number; last: string | null }>();
  const reports = new Map<string, { n: number; last: string | null }>();
  const picks = new Map<string, { n: number; last: string | null }>();
  const spent = new Map<string, { pence: number; last: string | null }>();
  const bump = (map: Map<string, { n: number; last: string | null }>, id: string, at: string | null) => {
    const cur = map.get(id) ?? { n: 0, last: null };
    map.set(id, { n: cur.n + 1, last: latestOf(cur.last, at) });
  };
  for (const r of input.opens) bump(opens, r.user_id, r.opened_at);
  for (const r of input.reports) bump(reports, r.user_id, r.created_at);
  for (const r of input.picks) bump(picks, r.user_id, r.sent_at);
  for (const r of input.debits) {
    const cur = spent.get(r.user_id) ?? { pence: 0, last: null };
    spent.set(r.user_id, { pence: cur.pence + Math.abs(Number(r.amount_pence) || 0), last: latestOf(cur.last, r.at) });
  }
  return input.profiles.map((p) => ({
    id: p.id,
    name: p.full_name?.trim() || null,
    email: p.email,
    mobile: p.mobile?.trim() || null,
    planCode: p.plan_code || null,
    dealOpens: opens.get(p.id)?.n ?? 0,
    reports: reports.get(p.id)?.n ?? 0,
    picks: picks.get(p.id)?.n ?? 0,
    creditSpentPence: spent.get(p.id)?.pence ?? 0,
    // A pick received is not the member doing something; the rest are.
    lastActiveAt: latestOf(p.last_seen_at, opens.get(p.id)?.last, reports.get(p.id)?.last, spent.get(p.id)?.last),
  }));
}

export function isHighIntent(m: Pick<MemberActivity, 'dealOpens' | 'reports'>): boolean {
  return m.dealOpens >= HIGH_INTENT_OPENS || m.reports >= HIGH_INTENT_REPORTS;
}

/** What "most active" means: things the member did, opens and reports first. */
export function activityScore(m: Pick<MemberActivity, 'dealOpens' | 'reports' | 'picks'>): number {
  return m.dealOpens * 3 + m.reports * 3 + m.picks;
}

export const SORT_KEYS = ['activity', 'name', 'email', 'mobile', 'plan', 'opens', 'reports', 'picks', 'spent', 'lastActive'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === 'string' && (SORT_KEYS as readonly string[]).includes(v);
}

/** The direction a column starts in when first clicked: numbers and dates high first, text A→Z. */
export function defaultDir(key: SortKey): SortDir {
  return key === 'name' || key === 'email' || key === 'mobile' || key === 'plan' ? 'asc' : 'desc';
}

function text(v: string | null): string {
  return (v ?? '').toLowerCase();
}

function compare(a: MemberActivity, b: MemberActivity, key: SortKey): number {
  switch (key) {
    case 'activity':
      return activityScore(a) - activityScore(b);
    case 'name':
      return text(a.name).localeCompare(text(b.name));
    case 'email':
      return text(a.email).localeCompare(text(b.email));
    case 'mobile':
      return text(a.mobile).localeCompare(text(b.mobile));
    case 'plan':
      return text(a.planCode).localeCompare(text(b.planCode));
    case 'opens':
      return a.dealOpens - b.dealOpens;
    case 'reports':
      return a.reports - b.reports;
    case 'picks':
      return a.picks - b.picks;
    case 'spent':
      return a.creditSpentPence - b.creditSpentPence;
    case 'lastActive':
      return (time(a.lastActiveAt) ?? -Infinity) - (time(b.lastActiveAt) ?? -Infinity);
  }
}

/**
 * Sorted copy. Ties fall back to activity, then last active, then email,
 * so the order is stable however the page is sorted; blanks sort last in
 * either direction for text columns.
 */
export function sortMembers(rows: MemberActivity[], key: SortKey, dir: SortDir): MemberActivity[] {
  const sign = dir === 'asc' ? 1 : -1;
  const isText = key === 'name' || key === 'email' || key === 'mobile' || key === 'plan';
  const blank = (m: MemberActivity) => (key === 'name' ? !m.name : key === 'email' ? !m.email : key === 'mobile' ? !m.mobile : key === 'plan' ? !m.planCode : false);
  return [...rows].sort((a, b) => {
    if (isText && blank(a) !== blank(b)) return blank(a) ? 1 : -1;
    const primary = compare(a, b, key) * sign;
    if (primary !== 0) return primary;
    const byActivity = activityScore(b) - activityScore(a);
    if (byActivity !== 0) return byActivity;
    const byActive = (time(b.lastActiveAt) ?? -Infinity) - (time(a.lastActiveAt) ?? -Infinity);
    if (byActive !== 0) return byActive;
    return text(a.email).localeCompare(text(b.email));
  });
}
