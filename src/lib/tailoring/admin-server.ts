import 'server-only';

/**
 * The reads behind /admin/tailoring (Batch 14, Part G; the sums are in
 * admin-stats.ts). Service role only; the page checks the admin session
 * first. Never throws. Leaves out the accounts every admin figure leaves out
 * (admins, staff, switched off), by Batch 9's own rule (exclusionFor).
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { adminEmails } from '../admin';
import { emailKey } from '../supabase/email-key';
import { exclusionFor } from '../activity/metrics';
import { TAKE_UP_KINDS, type TakeUpEvent } from '../analysis/take-up';
import { DEFAULT_GOALS, parseMarketGoals } from '../market/goals';
import { parseAboutYou } from '../profile/about';
import { emptyAnswers } from '../profile/questions';
import { EMPTY_QUIZ, parseQuizRow, progress, seedFromGoals, type QuizRecord } from '../profile/state';
import { todayKey } from '../today/day';
import { ACTION_KINDS, actionCounts, analysisByBlocker, keepRates, memberFact, type ActionEvent, type ActionRow, type AnalysisRow, type KeepEvent, type KeepRates, type MemberFact, type ShownDay } from './admin-stats';
import { TAILORING } from './config';

const LIMIT = 5000;
const PAGE = 1000;
// 50,000 events in the window is far beyond today's volume; past it the page says so.
const MAX_PAGES = 50;
const CHUNK = 200;

export type TailoringAdminLoad =
  | { status: 'ok'; days: number; members: number; keep: KeepRates; analysis: AnalysisRow[]; actions: ActionRow[]; capped: boolean }
  | { status: 'no_service_role' | 'failed'; message: string };

type Admin = ReturnType<typeof createAdminClient>;

async function paged<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await read(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

/** Each counted member, with the facts the figures group by: role, completeness, blocker, deals wanted. */
async function membersFor(admin: Admin): Promise<MemberFact[]> {
  const [profilesRes, quizRes, excludedRes] = await Promise.all([
    admin.from('profiles').select('id, email, market_goals, about_you').limit(LIMIT),
    admin.from('profile_quiz').select('user_id, started_at, completed_at, last_question, answered, finish_later_at, resumed_at, credit_grant_id, credit_skipped_reason, reminder_collapsed_day').limit(LIMIT),
    admin.from('activity_excluded_accounts').select('user_id, reason'),
  ]);
  if (profilesRes.error) throw new Error(profilesRes.error.message);
  const admins = new Set(adminEmails().map((e) => emailKey(e)));
  const manual = new Map<string, string | null>();
  for (const r of (excludedRes.data ?? []) as { user_id: string; reason: string | null }[]) manual.set(r.user_id, r.reason);
  const profiles = ((profilesRes.data ?? []) as { id: string; email: string | null; market_goals: unknown; about_you: unknown }[]).filter((p) => exclusionFor(p.email, manual.has(p.id) ? manual.get(p.id) : undefined, admins) === null);
  const quizBy = new Map<string, QuizRecord>();
  if (!quizRes.error) for (const r of (quizRes.data ?? []) as { user_id: string }[]) {
    const rec = parseQuizRow(r);
    if (rec) quizBy.set(r.user_id, rec);
  }
  const ids = profiles.map((p) => p.id);
  const areasBy = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await admin.from('saved_areas').select('user_id, postcode_area').in('user_id', ids.slice(i, i + CHUNK));
    for (const r of (data ?? []) as { user_id: string; postcode_area: string }[]) areasBy.set(r.user_id, [...(areasBy.get(r.user_id) ?? []), r.postcode_area]);
  }
  const now = new Date();
  return profiles.map((p) => {
    // Completeness as Batch 12's admin page measures it (state.ts progress).
    const goals = parseMarketGoals(p.market_goals);
    const about = parseAboutYou(p.about_you);
    let answers = emptyAnswers(goals ?? DEFAULT_GOALS, about, areasBy.get(p.id) ?? []);
    let quiz = quizBy.get(p.id) ?? null;
    if (!quiz && goals) {
      const seeded = seedFromGoals(answers, now);
      answers = seeded.answers;
      quiz = { ...EMPTY_QUIZ, startedAt: null, answered: seeded.answered };
    }
    return memberFact(p.id, about, quiz ? progress(answers, quiz).percent : 0);
  });
}

/** Every member's Today in the window: the stored lists (per profile, and the older one-a-member list) and the day's pick. */
async function shownDays(admin: Admin, sinceIso: string, sinceDay: string): Promise<ShownDay[]> {
  const [lists, legacy, picks] = await Promise.all([
    paged<{ user_id: string; day: string; deal_ids: unknown }>((from, to) => admin.from('profile_today_lists').select('user_id, day, deal_ids').gte('day', sinceDay).order('day', { ascending: true }).order('profile_id', { ascending: true }).range(from, to)).catch(() => ({ rows: [], capped: false })),
    paged<{ user_id: string; day: string; deal_ids: unknown }>((from, to) => admin.from('today_selections').select('user_id, day, deal_ids').gte('day', sinceDay).order('day', { ascending: true }).order('user_id', { ascending: true }).range(from, to)).catch(() => ({ rows: [], capped: false })),
    paged<{ user_id: string; deal_id: string | null; sent_at: string }>((from, to) => admin.from('sourcing_sent').select('user_id, deal_id, sent_at').gte('sent_at', sinceIso).eq('status', 'sent').not('deal_id', 'is', null).order('sent_at', { ascending: true }).order('id', { ascending: true }).range(from, to)).catch(() => ({ rows: [], capped: false })),
  ]);
  const by = new Map<string, ShownDay>();
  const add = (userId: string, day: string, ids: string[]) => {
    const key = `${userId}|${day}`;
    const d = by.get(key) ?? { userId, day, dealIds: [] };
    d.dealIds = [...new Set([...d.dealIds, ...ids])];
    by.set(key, d);
  };
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  for (const r of [...lists.rows, ...legacy.rows]) add(r.user_id, String(r.day), ids(r.deal_ids));
  for (const r of picks.rows) if (r.deal_id) add(r.user_id, todayKey(new Date(r.sent_at)), [r.deal_id]);
  return [...by.values()];
}

export async function loadTailoringAdmin(now: Date = new Date()): Promise<TailoringAdminLoad> {
  if (!hasServiceRole()) return { status: 'no_service_role', message: 'SUPABASE_SERVICE_ROLE_KEY is not set.' };
  const days = TAILORING.adminWindowDays;
  const since = new Date(now.getTime() - days * 86_400_000);
  const admin = createAdminClient();
  try {
    const kinds = [...new Set<string>([...TAKE_UP_KINDS, 'keep', ...ACTION_KINDS])];
    const [members, shown, events] = await Promise.all([
      membersFor(admin),
      shownDays(admin, since.toISOString(), todayKey(since)),
      paged<TakeUpEvent>((from, to) => admin.from('activity_events').select('user_id, kind, deal_id, extras, occurred_at').in('kind', kinds).gte('occurred_at', since.toISOString()).order('occurred_at', { ascending: false }).order('id', { ascending: false }).range(from, to)),
    ]);
    const live = events.rows.filter((e) => !(e.extras && 'env' in e.extras));
    // A Keep from the grid or Today, or the email's "Yes, more like this" (Part F).
    const keeps: KeepEvent[] = live
      .filter((e) => e.deal_id && (e.kind === 'keep' || (e.kind === 'email_feedback' && e.extras?.part === 'teaser' && e.extras?.answer === 'yes')))
      .map((e) => ({ userId: e.user_id, dealId: e.deal_id!, at: e.occurred_at }));
    return {
      status: 'ok',
      days,
      members: members.length,
      keep: keepRates(shown, keeps, members),
      analysis: analysisByBlocker(live.filter((e) => (TAKE_UP_KINDS as readonly string[]).includes(e.kind)), members),
      actions: actionCounts(events.rows as ActionEvent[], members),
      capped: events.capped,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tailoring] admin figures failed:', message);
    return { status: 'failed', message };
  }
}
