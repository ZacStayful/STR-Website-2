import 'server-only';

/**
 * The one-off deal-types backfill (Batch 17, Part I): every existing profile
 * moved onto "Which deals do you want to see?" from its older answers, by
 * deal-types-backfill.ts. Shared by /api/internal/deal-types-backfill and
 * the button on /admin/profiles.
 *
 *   dry   every profile's before and after, and what would be written;
 *         writes nothing
 *   run   writes each profile that maps: the active one (or a member with no
 *         profile rows) through profiles.market_goals and profile_quiz, which
 *         the Batch 13 triggers copy into its row; any other in its own
 *         search_profiles row. Each write is checked against the row as read
 *         (its updated-at), so a member editing at the same moment is never
 *         overwritten: that profile is left for the next run.
 *
 * Idempotent: a profile with types is skipped, so a second run changes
 * nothing. It logs no activity (the members did nothing), costs nothing and
 * never charges.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { parseMarketGoals, type MarketGoals } from '../market/goals';
import { parseAboutYou, type AboutYou } from './about';
import { parseAnswered, type AnsweredMap } from './state';
import { backfillProfile, beforeOf, shortId, type BackfillAfter, type BackfillBefore } from './deal-types-backfill';

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1000;
const TIME_BUDGET_MS = 50_000;

interface MemberRow {
  id: string;
  market_goals: unknown;
  market_goals_updated_at: string | null;
  about_you: unknown;
}
interface ProfileRow {
  id: string;
  user_id: string;
  name: string;
  criteria: unknown;
  answered: unknown;
  is_active: boolean;
  updated_at: string;
}
interface QuizRow {
  user_id: string;
  answered: unknown;
  updated_at?: string | null;
}

export interface BackfillLine {
  member: string | null;
  profile: string | null;
  name: string | null;
  active: boolean;
  status: 'map' | 'already' | 'nothing' | 'no_goals';
  before: BackfillBefore;
  after: BackfillAfter | null;
  /** The real run only: written, or left for the next run (changed meanwhile, or the write failed). */
  written?: boolean;
  reason?: string;
}

async function readAll<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE) break;
  }
  return { rows, error: null };
}

/** One profile to move: where its goals and marks live, and how to write them back. */
interface Seat {
  member: MemberRow;
  about: AboutYou | null;
  profile: ProfileRow | null;
  /** The active profile, or a member with no profile rows: the member's own columns. */
  live: boolean;
  goals: MarketGoals | null;
  marks: AnsweredMap;
}

async function writeSeat(admin: Admin, seat: Seat, goals: MarketGoals, marks: AnsweredMap, quiz: QuizRow | undefined, nowIso: string): Promise<{ ok: boolean; reason?: string }> {
  if (seat.live) {
    let q = admin.from('profiles').update({ market_goals: goals, market_goals_updated_at: nowIso }).eq('id', seat.member.id);
    q = seat.member.market_goals_updated_at ? q.eq('market_goals_updated_at', seat.member.market_goals_updated_at) : q.is('market_goals_updated_at', null);
    const { data, error } = await q.select('id');
    if (error) return { ok: false, reason: 'write_failed' };
    if ((data ?? []).length === 0) return { ok: false, reason: 'changed_meanwhile' };
    // The marks, only on a quiz row that exists: a member who never began the quiz meets the gate anyway.
    if (quiz) {
      const { error: markErr } = await admin.from('profile_quiz').update({ answered: marks, updated_at: nowIso }).eq('user_id', seat.member.id);
      if (markErr) console.warn('[deal-types backfill] marks not written:', markErr.message);
    }
    return { ok: true };
  }
  const row = seat.profile!;
  const { data, error } = await admin.from('search_profiles').update({ criteria: goals, answered: marks, updated_at: nowIso }).eq('id', row.id).eq('user_id', seat.member.id).eq('updated_at', row.updated_at).select('id');
  if (error) return { ok: false, reason: 'write_failed' };
  if ((data ?? []).length === 0) return { ok: false, reason: 'changed_meanwhile' };
  return { ok: true };
}

export async function runDealTypesBackfill(opts: { dry: boolean; triggeredBy: string }): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!hasServiceRole()) return { status: 503, body: { error: 'The service role key is not set.' } };
  const started = Date.now();
  const now = new Date();
  const nowIso = now.toISOString();
  const admin = createAdminClient();

  const [members, profiles, quizzes] = await Promise.all([
    readAll<MemberRow>((from, to) => admin.from('profiles').select('id, market_goals, market_goals_updated_at, about_you').order('id', { ascending: true }).range(from, to)),
    readAll<ProfileRow>((from, to) => admin.from('search_profiles').select('id, user_id, name, criteria, answered, is_active, updated_at').is('deleted_at', null).order('id', { ascending: true }).range(from, to)),
    readAll<QuizRow>((from, to) => admin.from('profile_quiz').select('user_id, answered').order('user_id', { ascending: true }).range(from, to)),
  ]);
  if (members.error) return { status: 500, body: { error: `members unreadable: ${members.error}` } };
  if (quizzes.error) return { status: 500, body: { error: `quiz marks unreadable: ${quizzes.error}` } };
  // Before Batch 13's schema: one profile each, the member's own columns.
  const profilesReadable = profiles.error === null;
  const byMember = new Map<string, ProfileRow[]>();
  for (const p of profilesReadable ? profiles.rows : []) byMember.set(p.user_id, [...(byMember.get(p.user_id) ?? []), p]);
  const quizOf = new Map(quizzes.rows.map((q) => [q.user_id, q]));

  const seats: Seat[] = [];
  for (const m of members.rows) {
    const about = parseAboutYou(m.about_you);
    const memberMarks = parseAnswered(quizOf.get(m.id)?.answered ?? {});
    const rows = byMember.get(m.id) ?? [];
    if (rows.length === 0) {
      seats.push({ member: m, about, profile: null, live: true, goals: parseMarketGoals(m.market_goals), marks: memberMarks });
      continue;
    }
    for (const p of rows) {
      seats.push(p.is_active
        ? { member: m, about, profile: p, live: true, goals: parseMarketGoals(m.market_goals), marks: memberMarks }
        : { member: m, about, profile: p, live: false, goals: parseMarketGoals(p.criteria), marks: parseAnswered(p.answered) });
    }
  }

  const lines: BackfillLine[] = [];
  const counts = { map: 0, already: 0, nothing: 0, no_goals: 0, written: 0, left: 0 };
  let outOfTime = false;
  for (const seat of seats) {
    const outcome = backfillProfile(seat.goals, seat.about, seat.marks, now);
    counts[outcome.status] += 1;
    const line: BackfillLine = {
      member: shortId(seat.member.id),
      profile: shortId(seat.profile?.id),
      name: seat.profile?.name ?? null,
      active: seat.live,
      status: outcome.status,
      before: beforeOf(seat.goals, seat.about),
      after: outcome.status === 'map' ? outcome.after : null,
    };
    if (outcome.status === 'map' && !opts.dry) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        outOfTime = true;
        line.written = false;
        line.reason = 'out_of_time';
        counts.left += 1;
      } else {
        const res = await writeSeat(admin, seat, outcome.goals, outcome.marks, quizOf.get(seat.member.id), nowIso);
        line.written = res.ok;
        if (res.ok) counts.written += 1;
        else {
          counts.left += 1;
          line.reason = res.reason;
        }
      }
    }
    lines.push(line);
  }
  // Profiles that change first, then the rest, each in a stable order.
  const order = { map: 0, already: 1, nothing: 2, no_goals: 3 } as const;
  lines.sort((a, b) => order[a.status] - order[b.status] || (a.member ?? '').localeCompare(b.member ?? '') || (a.profile ?? '').localeCompare(b.profile ?? ''));

  if (!opts.dry) console.info(`[deal-types backfill] by ${opts.triggeredBy}: ${counts.written} written, ${counts.left} left, ${counts.already} already on types`);
  return {
    status: 200,
    body: {
      dry: opts.dry,
      profilesReadable,
      members: members.rows.length,
      profiles: seats.length,
      toMap: counts.map,
      alreadyOnTypes: counts.already,
      nothingToGoOn: counts.nothing,
      noGoals: counts.no_goals,
      ...(opts.dry ? {} : { written: counts.written, leftForNextRun: counts.left, outOfTime }),
      lines,
    },
  };
}
