import 'server-only';

/**
 * The profile quiz's reads and writes (Batch 12). The rules are pure and
 * tested next door (questions.ts, state.ts, credit.ts, matching.ts); this
 * is where they meet the database, the credit ledger and the activity log.
 *
 *   profileSummaryFor     one read per request (React cache): the answers,
 *                         the quiz row and the progress. Seeds the quiz for a
 *                         member who answered before it existed.
 *   requireProfileStart   the gate: the three mandatory questions before
 *                         anything else (AppShell). Team members are exempt.
 *   answerQuestion        one answer: saved with the member's own session,
 *                         the bookkeeping with the service role, the count
 *                         re-read, the £5 settled, the event logged.
 *   previewMatchCount     the live count while the radius slider moves.
 *   sampleMatches         one or two matching deals, the unopened card only.
 *   profileNudgesFor      "Your profile is 60% done" for the daily email.
 *
 * Nothing here charges credit for a count: the one metered call is placing
 * a new home postcode on the map when it is saved, exactly as the welcome
 * screen and the Explorer's goals panel did before.
 */
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { teamOf } from '../team';
import { isAdminEmail } from '../admin';
import { DEFAULT_GOALS, parseMarketGoals, type MarketGoals } from '../market/goals';
import { areaCodeFrom } from '../market/lead-goals';
import { parseAboutYou } from './about';
import { applyAnswer, clearAnswer, emptyAnswers, questionById, questionsFor, SECTION_TOKENS, type Answers, type QuestionId, type WhereAnswer } from './questions';
import { EMPTY_QUIZ, parseQuizRow, progress, seedFromGoals, type AnsweredMap, type Progress, type QuizRecord } from './state';
import { profileFilters, profileFiltersByType } from './matching';
import { typesShown } from './deal-types';
import { creditLine, profileCreditDecision, profileCreditRef, PROFILE_CREDIT_KIND, type CreditDecision } from './credit';
import { rewardEligibility, type Eligibility } from '../today/checklist';
import { grant, InsufficientCreditError } from '../credit/ledger';
import { getBillingSettings } from '../credit/unit-costs';
import { startAction, welcomeGranted } from '../credit/action';
import { newActionId, runMetered } from '../credit/context';
import { geocodePostcode } from '../apis/geocode';
import { countDealsAcross, listDeals, photoUrlFor } from '../marketplace/queries';
import { dealVisibilityFor } from '../marketplace/tier';
import { areaDealView, type AreaDealView } from '../marketplace/grid';
import { memberFinance } from '../marketplace/most-you-can-pay';
import { rangeLineFor } from '../project/display';
import { quizPathFor } from '../auth/landing';
import { logActivity } from '../activity/log';
import { logConversion } from '../meta/conversions';
import { queueFunnelSync } from '../crm/monday-funnel/queue-server';
import { todayKey } from '../today/day';
import { mustHaveCountFor, rechooseForMember, tailoringPreview } from '../tailoring/server';

type Admin = ReturnType<typeof createAdminClient>;

interface ProfileRow {
  market_goals: unknown;
  about_you: unknown;
  welcome_checked_at: string | null;
  welcome_withheld_reason: string | null;
}

export interface ProfileSummary {
  userId: string;
  /** A team member is never gated, reminded or paid: their credit and settings are the owner's. */
  teamMember: boolean;
  answers: Answers;
  quiz: QuizRecord;
  progress: Progress;
  /** The welcome check's verdict, which decides the £5 (src/lib/today/checklist.ts). */
  eligibility: Eligibility;
}

const QUIZ_COLUMNS = 'user_id, started_at, completed_at, last_question, answered, finish_later_at, resumed_at, credit_grant_id, credit_skipped_reason, reminder_collapsed_day';

function areasOf(rows: unknown): string[] {
  return ((rows ?? []) as { postcode_area: string }[]).map((r) => r.postcode_area);
}

/**
 * The member's profile as the pages read it: once per request. Null when
 * the profile cannot be read or the Batch 12 schema has not been run, and
 * then nothing is gated, shown or paid — a missing table must never lock
 * every member out.
 */
export const profileSummaryFor = cache(async (userId: string): Promise<ProfileSummary | null> => {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  const [profileRes, areasRes, quizRes, team] = await Promise.all([
    admin.from('profiles').select('market_goals, about_you, welcome_checked_at, welcome_withheld_reason').eq('id', userId).maybeSingle(),
    admin.from('saved_areas').select('postcode_area').eq('user_id', userId),
    admin.from('profile_quiz').select(QUIZ_COLUMNS).eq('user_id', userId).maybeSingle(),
    teamOf(userId),
  ]);
  if (profileRes.error || !profileRes.data) {
    if (profileRes.error) console.error('[profile] profile read failed:', profileRes.error.message);
    return null;
  }
  if (quizRes.error) {
    console.error('[profile] profile_quiz read failed (schema behind?):', quizRes.error.message);
    return null;
  }
  const p = profileRes.data as unknown as ProfileRow;
  const goals = parseMarketGoals(p.market_goals);
  const about = parseAboutYou(p.about_you);
  let answers = emptyAnswers(goals ?? DEFAULT_GOALS, about, areasOf(areasRes.data));
  let quiz = parseQuizRow(quizRes.data);

  // Answered before the quiz existed (the welcome questions, the Explorer's
  // goals panel, a lead form): what those covered counts, once.
  if (!quiz && goals) {
    const seeded = await seedQuiz(admin, userId, answers);
    if (seeded) ({ answers, quiz } = seeded);
  }

  const record = quiz ?? EMPTY_QUIZ;
  const teamMember = team.role === 'member';
  return {
    userId,
    teamMember,
    answers,
    quiz: record,
    progress: progress(answers, record),
    eligibility: rewardEligibility({ welcomeCheckedAt: p.welcome_checked_at, welcomeWithheldReason: p.welcome_withheld_reason, teamMember }),
  };
});

async function seedQuiz(admin: Admin, userId: string, current: Answers): Promise<{ answers: Answers; quiz: QuizRecord } | null> {
  const now = new Date();
  const nowIso = now.toISOString();
  const seeded = seedFromGoals(current, now);
  const { error: upErr } = await admin.from('profiles').update({ market_goals: seeded.answers.goals, market_goals_updated_at: nowIso, about_you: seeded.answers.about, about_you_updated_at: nowIso }).eq('id', userId);
  if (upErr) {
    console.error('[profile] seed write failed:', upErr.message);
    return null;
  }
  // Another request may have seeded meanwhile: the first row wins, then it is read back.
  const { error: insErr } = await admin.from('profile_quiz').upsert({ user_id: userId, started_at: nowIso, answered: seeded.answered, updated_at: nowIso }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (insErr) {
    console.error('[profile] seed row failed:', insErr.message);
    return null;
  }
  const { data } = await admin.from('profile_quiz').select(QUIZ_COLUMNS).eq('user_id', userId).maybeSingle();
  return { answers: seeded.answers, quiz: parseQuizRow(data) ?? { ...EMPTY_QUIZ, startedAt: nowIso, answered: seeded.answered } };
}

/**
 * The gate: a member who has not answered the three mandatory questions is
 * sent to the quiz, with the page they wanted as the way back. Team members
 * are never gated. Called by AppShell, so every members-only page is behind
 * it and /welcome itself (which does not use the shell) never loops.
 */
export async function requireProfileStart(userId: string, returnTo: string): Promise<ProfileSummary | null> {
  const s = await profileSummaryFor(userId);
  if (!s || s.teamMember || s.progress.mandatoryDone) return s;
  redirect(quizPathFor(returnTo));
}

// ── Answering ──

export interface ProgressView {
  percent: number;
  minutesLeft: number;
  next: QuestionId | null;
  complete: boolean;
  mandatoryDone: boolean;
  questions: QuestionId[];
}

export interface CreditView {
  paid: boolean;
  /** 'paid' | 'pay' | 'wait' | 'never' | 'off' */
  state: string;
  line: string;
  pence: number;
}

export interface QuizView {
  answers: Answers;
  answered: AnsweredMap;
  progress: ProgressView;
  matchCount: number | null;
  credit: CreditView;
}

export function progressView(p: Progress): ProgressView {
  return { percent: p.percent, minutesLeft: p.minutesLeft, next: p.next, complete: p.complete, mandatoryDone: p.mandatoryDone, questions: p.questions };
}

export interface AnswerInput {
  userId: string;
  email: string | null;
  /** The member's own session client: their answers are written as them. */
  supabase: SupabaseClient;
  questionId: string;
  value: unknown;
  notSure: boolean;
  /** Changing one answer from the profile page rather than working through the quiz. */
  editing: boolean;
}

export type AnswerOutcome = { ok: true; view: QuizView; warning: string | null } | { ok: false; error: string };

const fail = (error: string): AnswerOutcome => ({ ok: false, error });

export async function answerQuestion(input: AnswerInput): Promise<AnswerOutcome> {
  const { userId, supabase } = input;
  const s = await profileSummaryFor(userId);
  if (!s) return fail('Your profile cannot be saved right now. Please try again shortly.');
  const q = questionById(input.questionId);
  if (!q) return fail('Unknown question.');
  if (!questionsFor(s.answers).some((x) => x.id === q.id)) return fail('That question is not part of your profile.');
  if (input.notSure && q.mandatory) return fail('This one needs an answer.');

  let next: Answers;
  if (input.notSure) next = clearAnswer(q.id, s.answers);
  else {
    const r = applyAnswer(q.id, input.value, s.answers);
    if (!r.ok) return fail(r.error);
    next = r.answers;
  }
  const now = new Date();
  const nowIso = now.toISOString();
  let warning: string | null = null;

  // A new home postcode is placed on the map once (metered, as before); if
  // it cannot be, the picks and the grid at least get its own area. Batch 21
  // (B4): tried again on every later answer while the home is unplaced, so a
  // placement that failed at question 3 (no credit, a provider blip) does not
  // leave the radius a postcode area for ever; the warning only on the question.
  if (next.goals.home && next.goals.home.lat === null) {
    const placed = await placeHome(userId, input.email, next.goals);
    next = { ...next, goals: placed.goals };
    if (!placed.placed) {
      const own = areaCodeFrom(next.goals.home!.postcode);
      if (own && !next.savedAreas.includes(own)) next = { ...next, savedAreas: [...next.savedAreas, own] };
      if (q.id === 'where') warning = placed.why === 'out of credit' ? 'You’re out of credit, so we couldn’t place your postcode on the map yet. Your area still counts.' : null;
    }
  }

  // ── The answers, as the member (row policy: their own row only) ──
  if (JSON.stringify(next.goals) !== JSON.stringify(s.answers.goals)) {
    const { error } = await supabase.from('profiles').update({ market_goals: next.goals, market_goals_updated_at: nowIso }).eq('id', userId);
    if (error) {
      console.error('[profile] goals save failed:', error.message);
      return fail('Could not save your answer. Please try again.');
    }
  }
  if (JSON.stringify(next.about) !== JSON.stringify(s.answers.about)) {
    const { error } = await supabase.from('profiles').update({ about_you: next.about, about_you_updated_at: nowIso }).eq('id', userId);
    if (error) {
      console.error('[profile] about save failed (schema behind?):', error.message);
      return fail('Could not save your answer. Please try again.');
    }
    // Batch 20: Monday's "Next deal" follows the answer (queued, after the response).
    if (next.about.nextDeal !== s.answers.about.nextDeal) after(() => queueFunnelSync(userId, 'next_deal'));
  }
  await syncSavedAreas(supabase, userId, s.answers.savedAreas, next.savedAreas);

  // ── The bookkeeping, as the service role ──
  const answered: AnsweredMap = { ...s.quiz.answered, [q.id]: { at: nowIso, notSure: input.notSure } };
  const quiz: QuizRecord = { ...s.quiz, answered, startedAt: s.quiz.startedAt ?? nowIso, lastQuestion: q.id };
  const prog = progress(next, quiz);
  if (prog.complete && !quiz.completedAt) quiz.completedAt = nowIso;
  // Batch 21 (G6): the answer is saved above; nothing from here may throw out
  // of the server action, or the member lands on Next's error page mid-quiz
  // (the Quiz has no boundary). A failure is logged and the view falls back
  // to what is known: the credit as the page would show it, the count unknown.
  let credit: CreditView = { paid: false, state: 'off', line: '', pence: 0 };
  let matchCount: number | null = null;
  try {
    const admin = createAdminClient();
    const { error: rowErr } = await admin
      .from('profile_quiz')
      .upsert({ user_id: userId, started_at: quiz.startedAt, completed_at: quiz.completedAt, last_question: q.id, answered, updated_at: nowIso }, { onConflict: 'user_id' });
    if (rowErr) console.error('[profile] quiz row save failed:', rowErr.message);

    credit = await settleProfileCredit(admin, userId, quiz, prog, s.eligibility);

    // ── What happened, for the log (question ids, never an answer) ──
    const extras = { question: q.id, section: SECTION_TOKENS[q.section] };
    if (input.editing) logActivity(userId, 'profile_edited', { extras });
    else logActivity(userId, input.notSure ? 'profile_not_sure' : 'profile_answered', { extras });
    if (!s.progress.mandatoryDone && prog.mandatoryDone) logActivity(userId, 'welcome_completed', { dedupeKey: 'welcome_completed' });
    if (!s.quiz.completedAt && prog.complete) {
      logActivity(userId, 'profile_completed', { extras: { real: prog.real, not_sure: prog.notSure, credit: credit.state }, dedupeKey: 'profile_completed' });
      // Batch 19: Meta's ProfileComplete, at the first completion (the £5 may come later, or never).
      await logConversion({ name: 'ProfileComplete', userId });
    }

    // Batch 14: today's list follows the answer (after the response: it never holds the quiz up, and never charges).
    after(() => rechooseForMember({ userId, email: input.email, goals: next.goals, savedAreas: next.savedAreas, answered, answeredAt: nowIso }).then(() => undefined));
    matchCount = await matchCountFor({ userId, email: input.email, answers: next, answered });
  } catch (err) {
    console.error('[profile] answer bookkeeping failed (the answer itself is saved):', (err as Error)?.message ?? err);
    credit = await creditViewFor(s).catch(() => credit);
  }
  return { ok: true, warning, view: { answers: next, answered, progress: progressView(prog), matchCount, credit } };
}

/** The "specific areas" answer is the member's saved areas: add the new ones, drop the old. */
async function syncSavedAreas(supabase: SupabaseClient, userId: string, before: string[], after: string[]): Promise<void> {
  const remove = before.filter((c) => !after.includes(c));
  const add = after.filter((c) => !before.includes(c));
  if (remove.length > 0) {
    const { error } = await supabase.from('saved_areas').delete().eq('user_id', userId).in('postcode_area', remove);
    if (error) console.error('[profile] saved areas delete failed:', error.message);
  }
  if (add.length > 0) {
    const { error } = await supabase.from('saved_areas').upsert(add.map((postcode_area) => ({ user_id: userId, postcode_area })), { onConflict: 'user_id,postcode_area', ignoreDuplicates: true });
    if (error) console.error('[profile] saved areas insert failed:', error.message);
  }
}

async function placeHome(userId: string, email: string | null, goals: MarketGoals): Promise<{ goals: MarketGoals; placed: boolean; why: string | null }> {
  if (!goals.home) return { goals, placed: false, why: null };
  try {
    const admin = isAdminEmail(email);
    // Batch 21 (B4, B46): an account that was not given the welcome credit (a
    // pack-era sign-up at "Where should we look?", three screens before the
    // pack is offered) has its placement billed to the house. It costs under
    // a penny; refusing it (CREDIT_ENFORCE on) left the home unplaced and the
    // radius a postcode area for ever, and debiting it (shadow mode) sent
    // "You're out of credit" mid-quiz. Logged with the member as the actor.
    const house = !admin && !(await welcomeGranted(userId));
    if (house) {
      const { lat, lng } = await runMetered({ userId: null, memberId: userId, admin: false, action: 'geocode', actionId: newActionId() }, () => geocodePostcode(goals.home!.postcode));
      return { goals: { ...goals, home: { ...goals.home, lat, lng } }, placed: true, why: null };
    }
    const action = await startAction({ userId, admin, action: 'geocode' });
    try {
      const { lat, lng } = await runMetered(action.ctx, () => geocodePostcode(goals.home!.postcode));
      return { goals: { ...goals, home: { ...goals.home, lat, lng } }, placed: true, why: null };
    } finally {
      await action.finish().catch(() => {});
    }
  } catch (err) {
    const why = err instanceof InsufficientCreditError ? 'out of credit' : ((err as Error)?.message ?? String(err));
    // Batch 21 (C13): the postcode area, never the postcode, in the log.
    console.warn(`[profile] could not place the home (${areaCodeFrom(goals.home.postcode) ?? 'no area'}): ${why}`);
    return { goals, placed: false, why };
  }
}

// ── The £5 ──

async function settleProfileCredit(admin: Admin, userId: string, quiz: QuizRecord, prog: Progress, eligibility: Eligibility): Promise<CreditView> {
  const settings = await getBillingSettings();
  const pence = settings.profileCompletePence;
  if (quiz.creditGrantId) return { paid: true, state: 'paid', line: creditLine({ paid: true, decision: null, pence }), pence };
  if (pence <= 0) return { paid: false, state: 'off', line: '', pence };
  let decision: CreditDecision;
  if (quiz.creditSkippedReason === 'team_member' || quiz.creditSkippedReason === 'welcome_withheld') decision = { kind: 'never', reason: quiz.creditSkippedReason };
  else decision = profileCreditDecision({ eligibility, progress: prog, minRealPct: settings.profileCreditMinRealPct });

  if (decision.kind === 'never' && !quiz.creditSkippedReason) {
    const { error } = await admin.from('profile_quiz').update({ credit_skipped_reason: decision.reason }).eq('user_id', userId).is('credit_grant_id', null);
    if (error) console.warn('[profile] credit skip mark failed:', error.message);
  }
  if (decision.kind === 'pay') {
    try {
      // Idempotent on source_ref: a retry, or two requests at once, can only ever pay once.
      const grantId = await grant(userId, PROFILE_CREDIT_KIND, pence, { sourceRef: profileCreditRef(userId), description: 'Profile complete' });
      if (grantId) {
        const { error } = await admin.from('profile_quiz').update({ credit_grant_id: grantId }).eq('user_id', userId).is('credit_grant_id', null);
        if (error) console.warn('[profile] credit record failed:', error.message);
        return { paid: true, state: 'paid', line: creditLine({ paid: true, decision: null, pence }), pence };
      }
    } catch (err) {
      console.error('[profile] credit grant failed:', (err as Error)?.message ?? err);
    }
  }
  return { paid: false, state: decision.kind === 'wait' ? decision.reason : decision.kind, line: creditLine({ paid: false, decision, pence }), pence };
}

/** The credit as the profile page and the celebration screen show it, without paying anything. */
export async function creditViewFor(s: ProfileSummary): Promise<CreditView> {
  const settings = await getBillingSettings();
  const pence = settings.profileCompletePence;
  if (s.quiz.creditGrantId) return { paid: true, state: 'paid', line: creditLine({ paid: true, decision: null, pence }), pence };
  if (pence <= 0) return { paid: false, state: 'off', line: '', pence };
  const decision: CreditDecision =
    s.quiz.creditSkippedReason === 'team_member' || s.quiz.creditSkippedReason === 'welcome_withheld'
      ? { kind: 'never', reason: s.quiz.creditSkippedReason }
      : profileCreditDecision({ eligibility: s.eligibility, progress: s.progress, minRealPct: settings.profileCreditMinRealPct });
  return { paid: false, state: decision.kind === 'wait' ? decision.reason : decision.kind, line: creditLine({ paid: false, decision: s.progress.complete ? decision : null, pence }), pence };
}

// ── The count and the samples ──

/**
 * "N deals match you": the grid's own head count for these answers. Never
 * charged. Batch 14: for a tailored profile, the deals that meet every
 * must-have instead, which is the count Today shows (`answered`: marks saved
 * in this same request, which a cached read could miss).
 */
export async function matchCountFor(p: { userId: string; email: string | null; answers: Answers; answered?: AnsweredMap }): Promise<number | null> {
  const tailoring = await tailoringPreview(p.userId, p.answers, p.answered);
  const must = await mustHaveCountFor({ userId: p.userId, email: p.email, tailoring }).catch(() => null);
  if (must !== null) return must;
  const visibility = await dealVisibilityFor(p.userId, isAdminEmail(p.email));
  // Batch 17: each deal type the profile is shown, on its own money answer, summed (as Today counts).
  const types = typesShown({ goals: p.answers.goals, about: p.answers.about });
  return countDealsAcross(profileFiltersByType(p.answers.goals, p.answers.savedAreas, types), visibility, { userId: p.userId });
}

/** The count for a "where" answer that has not been saved yet (the slider moving). */
export async function previewMatchCount(p: { userId: string; email: string | null; where: WhereAnswer }): Promise<number | null> {
  const s = await profileSummaryFor(p.userId);
  if (!s) return null;
  const r = applyAnswer('where', p.where, s.answers);
  if (!r.ok) return null;
  return matchCountFor({ userId: p.userId, email: p.email, answers: r.answers });
}

export interface SampleDeal extends AreaDealView {
  /** The profit as a range at the member's finance (Batch 10), when the deal has the figures. */
  range: string | null;
}

/**
 * Up to two deals that match the answers so far, as the unopened card: the
 * photo through the signed route, the figures, town and outcode, the type.
 * Never the address, the postcode or the listing link (PUBLIC_DEAL_COLUMNS),
 * and no link to the deal either: nothing in the quiz opens anything.
 */
export async function sampleMatches(p: { userId: string; email: string | null; limit?: number }): Promise<SampleDeal[]> {
  const s = await profileSummaryFor(p.userId);
  if (!s) return [];
  const [visibility, settings] = await Promise.all([dealVisibilityFor(p.userId, isAdminEmail(p.email)), getBillingSettings()]);
  const now = new Date();
  // Batch 17: only the deal types the profile is shown.
  const page = await listDeals({ ...profileFilters(s.answers.goals, s.answers.savedAreas), types: typesShown({ goals: s.answers.goals, about: s.answers.about }) }, visibility, { userId: p.userId });
  return page.cards.slice(0, p.limit ?? 2).map((card) => ({
    ...areaDealView(card, photoUrlFor(card, now), now, settings.dealPricing.profitRangePct),
    // The member's finance as Today prices it: a cash buyer borrows nothing.
    range: rangeLineFor(card, memberFinance(s.answers.goals), settings.dealPricing.profitRangePct),
  }));
}

// ── Leaving and coming back ──

/** "Finish later": where they stopped is kept for the admin drop-off table, and the event logged. */
export async function markFinishLater(userId: string, question: string | null): Promise<void> {
  if (!hasServiceRole()) return;
  const nowIso = new Date().toISOString();
  const q = question && questionById(question) ? question : null;
  const { error } = await createAdminClient().from('profile_quiz').upsert({ user_id: userId, finish_later_at: nowIso, updated_at: nowIso, ...(q ? { last_question: q } : {}) }, { onConflict: 'user_id' });
  if (error) console.warn('[profile] finish-later mark failed:', error.message);
  logActivity(userId, 'profile_finish_later', { extras: { question: q } });
}

/** The quiz opened: started (no row yet) or resumed (an unfinished one). One event a day either way. */
export async function markQuizOpened(userId: string, s: ProfileSummary, now: Date): Promise<void> {
  if (s.progress.complete) return;
  const day = todayKey(now);
  if (!s.quiz.startedAt) {
    logActivity(userId, 'profile_started', { dedupeKey: 'profile_started' });
    return;
  }
  if (hasServiceRole()) {
    const { error } = await createAdminClient().from('profile_quiz').update({ resumed_at: now.toISOString() }).eq('user_id', userId);
    if (error) console.warn('[profile] resume mark failed:', error.message);
  }
  logActivity(userId, 'profile_resumed', { extras: { question: s.progress.next }, dedupeKey: `profile_resumed:${day}` });
}

/** The Today reminder card, collapsed for the rest of this Today-day. */
export async function collapseReminder(userId: string, now: Date): Promise<void> {
  if (!hasServiceRole()) return;
  const nowIso = now.toISOString();
  const { error } = await createAdminClient().from('profile_quiz').upsert({ user_id: userId, reminder_collapsed_day: todayKey(now), updated_at: nowIso }, { onConflict: 'user_id' });
  if (error) console.warn('[profile] reminder collapse failed:', error.message);
  logActivity(userId, 'profile_reminder_collapsed');
}

/** Whether the Today card shows: incomplete, not a team member, not collapsed for this day. */
export function reminderDue(s: ProfileSummary | null, now: Date): boolean {
  if (!s || s.teamMember || s.progress.complete) return false;
  return s.quiz.reminderCollapsedDay !== todayKey(now);
}

// ── The daily email ──

const CHUNK = 200;

/**
 * Members whose profile is not complete, with their percentage, for the one
 * line in the daily email. Team members are the callers' to leave out (they
 * know who pays for whom). A member who answered before the quiz existed is
 * measured as they would be seeded, without writing anything.
 */
export async function profileNudgesFor(admin: Admin, userIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const now = new Date();
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const ids = userIds.slice(i, i + CHUNK);
    const [profiles, areas, quizzes] = await Promise.all([
      admin.from('profiles').select('id, market_goals, about_you').in('id', ids),
      admin.from('saved_areas').select('user_id, postcode_area').in('user_id', ids),
      admin.from('profile_quiz').select(QUIZ_COLUMNS).in('user_id', ids),
    ]);
    if (profiles.error || quizzes.error) {
      console.warn('[profile] nudge read failed:', profiles.error?.message ?? quizzes.error?.message);
      return out;
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
      const prog = progress(answers, quiz ?? EMPTY_QUIZ);
      if (!prog.complete) out.set(p.id, prog.percent);
    }
  }
  return out;
}

/** The daily email's profile line for one member, or nothing. */
export function profileNudgeFor(percent: number | undefined, siteUrl: string): { percent: number; url: string } | undefined {
  if (percent === undefined) return undefined;
  return { percent, url: `${siteUrl.replace(/\/$/, '')}/profile` };
}
