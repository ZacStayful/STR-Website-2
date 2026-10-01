import 'server-only';

/**
 * The reads behind /admin/profile (Batch 12): every quiz row, the profiles
 * behind them, and the accounts the Weekly active page leaves out, folded
 * into the pure figures in profile.ts.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { adminEmails } from '../admin';
import { emailKey } from '../supabase/email-key';
import { exclusionFor } from '../activity/metrics';
import { DEFAULT_GOALS, parseMarketGoals } from '../market/goals';
import { parseAboutYou } from '../profile/about';
import { emptyAnswers } from '../profile/questions';
import { EMPTY_QUIZ, parseQuizRow, progress, seedFromGoals, type QuizRecord } from '../profile/state';
import { aggregateProfileStats, type ProfileStats, type QuizFact } from './profile';

const LIMIT = 5000;
const CHUNK = 200;

export type ProfileStatsLoad = { status: 'ok'; stats: ProfileStats; truncated: boolean } | { status: 'no_service_role' | 'schema_missing' | 'failed'; message: string };

export async function loadProfileStats(): Promise<ProfileStatsLoad> {
  if (!hasServiceRole()) return { status: 'no_service_role', message: 'SUPABASE_SERVICE_ROLE_KEY is not set.' };
  const admin = createAdminClient();
  const [quizRes, profilesRes, excludedRes] = await Promise.all([
    admin.from('profile_quiz').select('user_id, started_at, completed_at, last_question, answered, finish_later_at, resumed_at, credit_grant_id, credit_skipped_reason, reminder_collapsed_day').limit(LIMIT),
    admin.from('profiles').select('id, email, market_goals, about_you').limit(LIMIT),
    admin.from('activity_excluded_accounts').select('user_id, reason'),
  ]);
  if (quizRes.error) {
    const missing = /profile_quiz/.test(quizRes.error.message) || quizRes.error.code === '42P01';
    return { status: missing ? 'schema_missing' : 'failed', message: quizRes.error.message };
  }
  if (profilesRes.error) return { status: 'failed', message: profilesRes.error.message };
  // Batch 21 (E26): a failed read of the exclusions is a failure, not "nobody excluded".
  if (excludedRes.error) return { status: 'failed', message: excludedRes.error.message };

  const admins = new Set(adminEmails().map((e) => emailKey(e)));
  const manual = new Map<string, string | null>();
  for (const r of (excludedRes.data ?? []) as { user_id: string; reason: string | null }[]) manual.set(r.user_id, r.reason);
  const profiles = ((profilesRes.data ?? []) as { id: string; email: string | null; market_goals: unknown; about_you: unknown }[]).filter((p) => exclusionFor(p.email, manual.has(p.id) ? manual.get(p.id) : undefined, admins) === null);

  const quizBy = new Map<string, QuizRecord>();
  for (const r of (quizRes.data ?? []) as { user_id: string }[]) {
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
  const facts: QuizFact[] = [];
  for (const p of profiles) {
    const goals = parseMarketGoals(p.market_goals);
    let answers = emptyAnswers(goals ?? DEFAULT_GOALS, parseAboutYou(p.about_you), areasBy.get(p.id) ?? []);
    let quiz = quizBy.get(p.id) ?? null;
    if (!quiz && goals) {
      // Not seeded yet (they have not visited since the quiz shipped): measured as they would be.
      const seeded = seedFromGoals(answers, now);
      answers = seeded.answers;
      quiz = { ...EMPTY_QUIZ, startedAt: null, answered: seeded.answered };
    }
    if (!quiz) continue;
    const prog = progress(answers, quiz);
    facts.push({
      userId: p.id,
      startedAt: quiz.startedAt,
      completedAt: quiz.completedAt,
      lastQuestion: quiz.lastQuestion,
      percent: prog.percent,
      complete: prog.complete,
      notSure: prog.answered.filter((id) => quiz!.answered[id]?.notSure),
    });
  }
  return { status: 'ok', stats: aggregateProfileStats(facts, profiles.length), truncated: (quizRes.data?.length ?? 0) >= LIMIT || (profilesRes.data?.length ?? 0) >= LIMIT };
}
