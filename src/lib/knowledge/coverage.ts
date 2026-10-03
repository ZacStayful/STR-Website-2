/**
 * Batch 24: how much Stayful Intelligence answers from approved knowledge,
 * per UK week and channel, from si_question_counts (counts only: no member,
 * no question text).
 *
 *   asked          every question logged, except "member unhappy" (that is a
 *                  reaction to an answer, counted on its own)
 *   fromKnowledge  answered, with the entry used being one Zac approved (its
 *                  knowledge_ref, legacy refs mapped by refToSlug)
 *   answeredOther  answered without an approved entry (small talk, the
 *                  member's own figures from a tool, a guess)
 *
 * Chip taps are not in the log (they are fixed, approved questions), so
 * coverage is calls, texts and (Batch 26) the chat.
 *
 * Pure: no network, no database, no server-only.
 */
import { refToSlug } from './seed.ts';

export interface CountRow {
  week: string;
  channel: string;
  outcome: string;
  ref: string | null;
  n: number;
}

export interface Tally {
  asked: number;
  fromKnowledge: number;
  answeredOther: number;
  lowConfidence: number;
  couldNotAnswer: number;
  handedOff: number;
  memberUnhappy: number;
}

export interface WeekCoverage {
  week: string;
  total: Tally;
  byChannel: Record<string, Tally>;
}

export const emptyTally = (): Tally => ({ asked: 0, fromKnowledge: 0, answeredOther: 0, lowConfidence: 0, couldNotAnswer: 0, handedOff: 0, memberUnhappy: 0 });

/** si_question_counts' jsonb, defensively: a malformed row is dropped. */
export function parseCounts(raw: unknown): CountRow[] {
  if (!Array.isArray(raw)) return [];
  const out: CountRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const n = Number(o.n);
    if (typeof o.week !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.week) || typeof o.channel !== 'string' || typeof o.outcome !== 'string' || !Number.isInteger(n) || n < 0) continue;
    out.push({ week: o.week, channel: o.channel, outcome: o.outcome, ref: typeof o.ref === 'string' ? o.ref : null, n });
  }
  return out;
}

function add(t: Tally, r: CountRow, approved: ReadonlySet<string>): void {
  switch (r.outcome) {
    case 'answered': {
      t.asked += r.n;
      const slug = refToSlug(r.ref);
      if (slug && approved.has(slug)) t.fromKnowledge += r.n;
      else t.answeredOther += r.n;
      break;
    }
    case 'low_confidence':
      t.asked += r.n;
      t.lowConfidence += r.n;
      break;
    case 'could_not_answer':
      t.asked += r.n;
      t.couldNotAnswer += r.n;
      break;
    case 'handed_off':
      t.asked += r.n;
      t.handedOff += r.n;
      break;
    case 'member_unhappy':
      t.memberUnhappy += r.n;
      break;
    default:
      t.asked += r.n;
  }
}

/**
 * The given weeks (Mondays, any order kept), each with its total and a tally
 * per channel. `approved` is every slug ever approved (a retired or stale
 * entry still counts for the weeks it answered in).
 */
export function tallyWeeks(rows: readonly CountRow[], weeks: readonly string[], approved: ReadonlySet<string>): WeekCoverage[] {
  const byWeek = new Map(weeks.map((w) => [w, { week: w, total: emptyTally(), byChannel: {} as Record<string, Tally> }]));
  for (const r of rows) {
    const w = byWeek.get(r.week);
    if (!w) continue;
    add(w.total, r, approved);
    add((w.byChannel[r.channel] ??= emptyTally()), r, approved);
  }
  return weeks.map((w) => byWeek.get(w)!);
}

/** The share answered from approved knowledge, 0–1, or null with nothing asked. */
export function knowledgeShare(t: Tally | null | undefined): number | null {
  return t && t.asked > 0 ? t.fromKnowledge / t.asked : null;
}

export const percent = (share: number | null): string => (share === null ? '—' : `${Math.round(share * 100)}%`);

/** "up 12 points", "down 3 points", "no change", or null when either week asked nothing. */
export function shareChange(now: number | null, before: number | null): string | null {
  if (now === null || before === null) return null;
  const d = Math.round(now * 100) - Math.round(before * 100);
  if (d === 0) return 'no change';
  return `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} point${Math.abs(d) === 1 ? '' : 's'}`;
}
