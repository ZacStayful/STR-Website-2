/**
 * Batch 26: the sums behind the Chat panels on /admin/intelligence/chat.
 * Pure: the rows come from admin-server.ts.
 */
import { ukDay } from '../activity/week.ts';
import type { ChatSurface } from './config.ts';

export interface TurnFact {
  createdAt: string;
  surface: ChatSurface;
  status: 'pending' | 'answered' | 'no_answer' | 'failed';
  outcome: string | null;
  rawPence: number;
  chargedBasePence: number;
  chargedFacePence: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface DayCount {
  day: string;
  quick: number;
  full: number;
}

/** Questions per UK day by surface, the newest day first, every day in the window (zeros included). */
export function perDay(rows: readonly TurnFact[], days: number, now: Date): DayCount[] {
  const out = new Map<string, DayCount>();
  for (let i = 0; i < days; i++) {
    const day = ukDay(new Date(now.getTime() - i * 86_400_000));
    out.set(day, { day, quick: 0, full: 0 });
  }
  for (const r of rows) {
    const c = out.get(ukDay(new Date(r.createdAt)));
    if (c) c[r.surface] += 1;
  }
  return [...out.values()];
}

export interface Outcomes {
  asked: number;
  answered: number;
  dontKnow: number;
  unhappy: number;
  failed: number;
  answeredRate: number | null;
  dontKnowRate: number | null;
  unhappyRate: number | null;
}

/** answered / don't know / unhappy, per surface. Failed questions (errors, a page that went) are counted apart. */
export function outcomes(rows: readonly TurnFact[]): Outcomes {
  const done = rows.filter((r) => r.status !== 'pending');
  const failed = done.filter((r) => r.status === 'failed').length;
  const asked = done.length - failed;
  const unhappy = done.filter((r) => r.outcome === 'member_unhappy').length;
  const answered = done.filter((r) => r.status === 'answered').length;
  const dontKnow = done.filter((r) => r.status === 'no_answer').length;
  const rate = (n: number) => (asked > 0 ? n / asked : null);
  return { asked, answered, dontKnow, unhappy, failed, answeredRate: rate(answered), dontKnowRate: rate(dontKnow), unhappyRate: answered > 0 ? unhappy / answered : null };
}

export interface Money {
  /** What the model calls cost us, pence. */
  rawPence: number;
  /** What members were charged, base pence (the price before a grant's spend rate). */
  revenuePence: number;
  /** What came off balances. */
  facePence: number;
  marginPence: number;
  marginRate: number | null;
  /** Charged questions only. */
  medianChargePence: number | null;
  /** Of all input tokens on these calls, the share read from the prompt cache. */
  cacheHitRate: number | null;
  /** The share of questions that read anything from the cache. */
  anyCacheShare: number | null;
}

export function money(rows: readonly TurnFact[]): Money {
  let raw = 0;
  let revenue = 0;
  let face = 0;
  let read = 0;
  let allInput = 0;
  let anyCache = 0;
  let withCalls = 0;
  const charges: number[] = [];
  for (const r of rows) {
    raw += r.rawPence;
    revenue += r.chargedBasePence;
    face += r.chargedFacePence;
    if (r.chargedBasePence > 0) charges.push(r.chargedBasePence);
    const input = r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    if (input > 0) {
      withCalls += 1;
      allInput += input;
      read += r.cacheReadTokens;
      if (r.cacheReadTokens > 0) anyCache += 1;
    }
  }
  charges.sort((a, b) => a - b);
  const median = charges.length === 0 ? null : charges.length % 2 ? charges[(charges.length - 1) / 2] : (charges[charges.length / 2 - 1] + charges[charges.length / 2]) / 2;
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return {
    rawPence: round(raw),
    revenuePence: round(revenue),
    facePence: round(face),
    marginPence: round(revenue - raw),
    marginRate: revenue > 0 ? (revenue - raw) / revenue : null,
    medianChargePence: median === null ? null : round(median),
    cacheHitRate: allInput > 0 ? read / allInput : null,
    anyCacheShare: withCalls > 0 ? anyCache / withCalls : null,
  };
}

export interface WeekActive {
  week: string;
  chatUsers: number;
  /** Of them, weekly active at all (a full-view question counts on its own). */
  active: number;
  /** Of them, active on something besides the chat. */
  activeBeyondChat: number;
}

/**
 * The share of chat users who were weekly active. A full-view question is a
 * qualifying action itself, so "active at all" includes everyone who used
 * the full view; "beyond chat" is the honest measure of a reason to come back.
 */
export function activeShare(weeks: readonly string[], chatUsers: ReadonlyMap<string, ReadonlySet<string>>, qualifying: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>, chatKind: string): WeekActive[] {
  return weeks.map((week) => {
    const users = chatUsers.get(week) ?? new Set<string>();
    const byUser = qualifying.get(week) ?? new Map<string, ReadonlySet<string>>();
    let active = 0;
    let beyond = 0;
    for (const u of users) {
      const kinds = byUser.get(u);
      if (!kinds || kinds.size === 0) continue;
      active += 1;
      if ([...kinds].some((k) => k !== chatKind)) beyond += 1;
    }
    return { week, chatUsers: users.size, active, activeBeyondChat: beyond };
  });
}

export function pct(n: number | null): string {
  return n === null ? '—' : `${Math.round(n * 100)}%`;
}
