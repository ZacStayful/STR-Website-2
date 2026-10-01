import 'server-only';

import type { createAdminClient } from '../supabase/admin';
import { DEFAULT_GOALS, parseMarketGoals } from '../market/goals';
import { parseAboutYou } from './about';
import { emptyAnswers } from './questions';
import { EMPTY_QUIZ, parseQuizRow, progress, seedFromGoals, type QuizRecord } from './state';

type Admin = ReturnType<typeof createAdminClient>;

const CHUNK = 200;
const QUIZ_COLUMNS = 'user_id, started_at, completed_at, last_question, answered, finish_later_at, resumed_at, credit_grant_id, credit_skipped_reason, reminder_collapsed_day';

/**
 * Batch 21 (B49, Q16): which of these members have NOT answered the mandatory
 * questions (the gate on the app: roles, deal types, where, one money
 * question per type), measured exactly as the quiz measures them (a member
 * who answered before the quiz existed is seeded, nothing written). The
 * daily runs then send them no charged pick and no charged day, only the
 * rest of their Today with the profile line. Null when the rows cannot be
 * read: the callers then hold nobody back.
 */
export async function mandatoryIncompleteFor(admin: Admin, userIds: readonly string[]): Promise<Set<string> | null> {
  const out = new Set<string>();
  const now = new Date();
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const ids = userIds.slice(i, i + CHUNK);
    const [profiles, areas, quizzes] = await Promise.all([
      admin.from('profiles').select('id, market_goals, about_you').in('id', ids),
      admin.from('saved_areas').select('user_id, postcode_area').in('user_id', ids),
      admin.from('profile_quiz').select(QUIZ_COLUMNS).in('user_id', ids),
    ]);
    if (profiles.error || quizzes.error) {
      console.warn('[profile] mandatory read failed:', profiles.error?.message ?? quizzes.error?.message);
      return null;
    }
    const areasBy = new Map<string, string[]>();
    for (const r of (areas.data ?? []) as { user_id: string; postcode_area: string }[]) areasBy.set(r.user_id, [...(areasBy.get(r.user_id) ?? []), r.postcode_area]);
    const quizBy = new Map<string, QuizRecord>();
    for (const r of (quizzes.data ?? []) as { user_id: string }[]) {
      const rec = parseQuizRow(r);
      if (rec) quizBy.set(r.user_id, rec);
    }
    for (const p of (profiles.data ?? []) as { id: string; market_goals: unknown; about_you: unknown }[]) {
      const goals = parseMarketGoals(p.market_goals);
      let answers = emptyAnswers(goals ?? DEFAULT_GOALS, parseAboutYou(p.about_you), areasBy.get(p.id) ?? []);
      let quiz = quizBy.get(p.id) ?? null;
      if (!quiz && goals) {
        const seeded = seedFromGoals(answers, now);
        answers = seeded.answers;
        quiz = { ...EMPTY_QUIZ, answered: seeded.answered };
      }
      if (!progress(answers, quiz ?? EMPTY_QUIZ).mandatoryDone) out.add(p.id);
    }
  }
  return out;
}
