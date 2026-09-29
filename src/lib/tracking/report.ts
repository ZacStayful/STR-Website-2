/**
 * "Sign-ups by source" (Batch 19, /admin/signups): the sums. Pure.
 *
 * Who counts as a sign-up: an account made in the range, on the production
 * site, that has signed in at least once. Team invitees (their team pays),
 * admin, staff and accounts switched off with Batch 9's "Exclude" are left
 * out and counted in a note.
 *
 * Rows: utm_source → utm_campaign → utm_content (the ad), grouped without
 * regard to case. Untagged sign-ups sit under "direct / unknown", split by
 * the referring site; lead-form accounts under their lead source.
 *
 * Columns, each "n / base": sign-ups; finished the profile; first report
 * within 7 days (only members whose 7 days are over); paid (a top-up or a
 * paid plan invoice, annual included, not refunded); weekly active in weeks
 * 2, 3 and 4 after sign-up, where week 1 is the sign-up week (Monday to
 * Sunday, UK time) and a week only counts once it is over. Weekly active is
 * Batch 9's own definition (computeWeeklyActive), passed in.
 */
import { addDays, ukWeekRange, ukWeekStart } from '../activity/week.ts';
import { TRACKING } from './config.ts';

/** One account, as signup_source_facts returns it. */
export interface SignupFact {
  u: string;
  email: string | null;
  created: string;
  signed_in: boolean;
  /** The lead source of a lead-form account. */
  lead: string | null;
  a: {
    src: string | null;
    med: string | null;
    cmp: string | null;
    cnt: string | null;
    fb: boolean | null;
    ref: string | null;
    env: string | null;
    method: string | null;
    team: boolean | null;
  } | null;
  profile_done: string | null;
  first_report: string | null;
  first_paid: string | null;
}

/** `n` of `base`; the page shows both beside the %. */
export interface Share {
  n: number;
  base: number;
}

export interface SourceRow {
  key: string;
  label: string;
  /** 0 source, 1 campaign (or referring site), 2 ad. */
  level: 0 | 1 | 2;
  signups: number;
  profile: Share;
  firstReport: Share;
  paid: Share;
  /** Weeks 2, 3 and 4 after sign-up. */
  weeks: [Share, Share, Share];
  /** Fewer sign-ups than the report trusts: shown greyed. */
  grey: boolean;
  children: SourceRow[];
}

export interface SignupReport {
  total: SourceRow;
  rows: SourceRow[];
  left: { teamInvites: number; excluded: number; neverSignedIn: number; notProduction: number };
}

/**
 * Weekly active from Batch 9's drill-down: the weeks it covers, and for each
 * member the weeks they were active. Null when it could not be read (the
 * week columns then show nothing).
 */
export interface ActiveWeeks {
  weeks: ReadonlySet<string>;
  active: ReadonlyMap<string, ReadonlySet<string>>;
}

export const DIRECT = 'direct / unknown';
const DAY_MS = 86_400_000;

function clean(v: string | null | undefined): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
}

/** Where an account sits: [source, campaign or referring site, ad]. */
export function pathFor(f: SignupFact): string[] {
  const lead = clean(f.lead);
  if (!f.a && lead) return [`${lead} (lead form)`];
  const a = f.a;
  const tagged = !!a && !!(clean(a.src) || clean(a.med) || clean(a.cmp) || clean(a.cnt) || a.fb);
  if (!a || !tagged) return [DIRECT, clean(a?.ref) ?? '(no referring site)'];
  return [clean(a.src) ?? (a.fb ? 'facebook (click id only)' : '(no source)'), clean(a.cmp) ?? '(no campaign)', clean(a.cnt) ?? '(no ad)'];
}

interface MemberStats {
  profile: boolean;
  /** Null until the member's 7 days are over. */
  report: boolean | null;
  paid: boolean;
  /** Weeks 2–4: null until the week is over (or outside the weekly figures). */
  weeks: [boolean | null, boolean | null, boolean | null];
}

function statsFor(f: SignupFact, now: Date, weekly: ActiveWeeks | null, firstReportDays: number): MemberStats {
  const created = new Date(f.created).getTime();
  const windowEnd = created + firstReportDays * DAY_MS;
  const firstReport = f.first_report ? new Date(f.first_report).getTime() : null;
  const report = now.getTime() < windowEnd ? null : firstReport !== null && firstReport <= windowEnd;
  const week1 = ukWeekStart(new Date(created));
  const weeks = [2, 3, 4].map((n) => {
    const start = addDays(week1, 7 * (n - 1));
    if (!weekly || !weekly.weeks.has(start) || now < ukWeekRange(start).end) return null;
    return weekly.active.get(f.u)?.has(start) ?? false;
  }) as MemberStats['weeks'];
  return { profile: !!f.profile_done, report, paid: !!f.first_paid, weeks };
}

type Node = {
  key: string;
  label: string;
  level: 0 | 1 | 2;
  stats: MemberStats[];
  children: Map<string, Node>;
};

function node(key: string, label: string, level: 0 | 1 | 2): Node {
  return { key, label, level, stats: [], children: new Map() };
}

const share = (stats: MemberStats[], pick: (s: MemberStats) => boolean | null): Share => {
  let n = 0;
  let base = 0;
  for (const s of stats) {
    const v = pick(s);
    if (v === null) continue;
    base += 1;
    if (v) n += 1;
  }
  return { n, base };
};

function toRow(nd: Node, minRow: number): SourceRow {
  const s = nd.stats;
  const children = [...nd.children.values()].map((c) => toRow(c, minRow)).sort((a, b) => b.signups - a.signups || a.label.localeCompare(b.label));
  return {
    key: nd.key,
    label: nd.label,
    level: nd.level,
    signups: s.length,
    profile: share(s, (m) => m.profile),
    firstReport: share(s, (m) => m.report),
    paid: share(s, (m) => m.paid),
    weeks: [share(s, (m) => m.weeks[0]), share(s, (m) => m.weeks[1]), share(s, (m) => m.weeks[2])],
    grey: s.length < minRow,
    children,
  };
}

export function buildSignupReport(
  facts: readonly SignupFact[],
  opts: { now: Date; weekly: ActiveWeeks | null; excluded: ReadonlySet<string>; minRow?: number; firstReportDays?: number },
): SignupReport {
  const minRow = opts.minRow ?? TRACKING.minRowSignups;
  const days = opts.firstReportDays ?? TRACKING.firstReportDays;
  const left = { teamInvites: 0, excluded: 0, neverSignedIn: 0, notProduction: 0 };
  const total = node('total', 'All sign-ups', 0);
  const roots = new Map<string, Node>();
  for (const f of facts) {
    if (f.a?.env && f.a.env !== 'production') {
      left.notProduction += 1;
      continue;
    }
    if (!f.signed_in) {
      left.neverSignedIn += 1;
      continue;
    }
    if (f.a?.team) {
      left.teamInvites += 1;
      continue;
    }
    if (opts.excluded.has(f.u)) {
      left.excluded += 1;
      continue;
    }
    const stats = statsFor(f, opts.now, opts.weekly, days);
    total.stats.push(stats);
    let level: Map<string, Node> = roots;
    pathFor(f).forEach((label, i) => {
      const key = label.toLowerCase();
      let nd = level.get(key);
      if (!nd) {
        nd = node(key, label, i as 0 | 1 | 2);
        level.set(key, nd);
      }
      nd.stats.push(stats);
      level = nd.children;
    });
  }
  const rows = [...roots.values()].map((r) => toRow(r, minRow)).sort((a, b) => b.signups - a.signups || a.label.localeCompare(b.label));
  return { total: { ...toRow(total, minRow), grey: false }, rows, left };
}

/** "3 / 12 (25%)", or "—" when there is nothing to divide by. */
export function shareText(s: Share): string {
  if (s.base === 0) return '—';
  return `${s.n} / ${s.base} (${Math.round((s.n / s.base) * 100)}%)`;
}

/** How many UK weeks of weekly-active figures cover sign-ups since `from` (plus the four weeks after), capped. */
export function weeksToCover(from: Date | null, now: Date, cap: number = TRACKING.maxReportWeeks + 4): number {
  if (!from) return cap;
  const first = ukWeekStart(from);
  const current = ukWeekStart(now);
  const weeks = Math.round((ukWeekRange(current).start.getTime() - ukWeekRange(first).start.getTime()) / (7 * DAY_MS)) + 1;
  return Math.max(5, Math.min(cap, weeks));
}
