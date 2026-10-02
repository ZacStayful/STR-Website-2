import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GOALS_EDITOR_HREF, PROFILE_QUIZ_HREF } from "@/lib/nav";
import { MIN_MONTHS_RANGE, MIN_WEEKS_RANGE, MOTIVATION_MODE_LABELS, PRIORITY_LABELS, type MotivationMode, type Priority } from "@/lib/market/goals";
import { answerLabel, questionsFor, SECTION_TITLES, type SectionId } from "@/lib/profile/questions";
import { describeTypes } from "@/lib/profile/deal-types";
import { matchLabel } from "@/lib/profile/matching";
import { minutesLeftLabel, pillLabel } from "@/lib/profile/state";
import { creditViewFor, matchCountFor, profileSummaryFor } from "@/lib/profile/server";
import { logActivity } from "@/lib/activity/log";
import { todayKey } from "@/lib/today/day";
import { saveAdvancedAction } from "./actions";
import { profilesFor } from "@/lib/profiles/server";
import { labelsShown } from "@/lib/profiles/rules";
import { tailoringForMember } from "@/lib/tailoring/server";
import { activeCriteria, criterionForQuestion, modeOf, NOT_APPLIED, wantsFor } from "@/lib/tailoring/criteria";
import { isSwitchable } from "@/lib/tailoring/profile";
import { FilterModeSwitch } from "./_components/FilterModeSwitch";
import { DEFAULT_FINANCE } from "@/lib/listing/deal";

export const metadata: Metadata = {
  title: "Your profile — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const SECTION_ORDER: SectionId[] = ["about", "buy", "r2r", "source", "manage"];

/**
 * The profile page (Batch 12): every question the member gets, grouped by
 * section, with the current answer. Tap any answer to change that one
 * question in the quiz and come back. "Continue where you left off" while
 * the quiz is unfinished. The count under the heading is the same head
 * count Today shows, so a change moves it at once; the day's deals follow
 * from the next Today's 5.
 */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ via?: string | string[]; saved?: string | string[]; new?: string | string[]; mode?: string | string[] }> }) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/profile");

  const now = new Date();
  const summary = await profileSummaryFor(user.id);
  if (!summary) {
    return (
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-2xl px-4 py-8">
          <h1 className="text-2xl font-bold text-foreground">Your profile</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your profile can’t be read right now. Please try again shortly.</p>
        </div>
      </main>
    );
  }
  const [count, credit, savedProfiles] = await Promise.all([matchCountFor({ userId: user.id, email: user.email ?? null, answers: summary.answers, answered: summary.quiz.answered }), creditViewFor(summary), profilesFor(user.id)]);
  // Batch 14: which answers are must-haves and which nice-to-haves, for this profile.
  const tailoring = await tailoringForMember(user.id, savedProfiles.readable ? savedProfiles.active : null, summary.answers.goals, summary.answers.savedAreas, now);
  const switchedOn = tailoring ? activeCriteria(wantsFor(tailoring)) : new Set<string>();
  // Saved profiles (Batch 13): these answers are the active profile's; "About you" is shared by all of them.
  const profileName = savedProfiles.readable && savedProfiles.active && labelsShown(savedProfiles.all) ? savedProfiles.active.name : null;

  logActivity(user.id, "profile_viewed");
  if (first(params.via) === "email") logActivity(user.id, "profile_email_click", { source: "email_link", dedupeKey: `profile_email_click:${todayKey(now)}` });

  const { answers, quiz, progress } = summary;
  const questions = questionsFor(answers);
  const sections = SECTION_ORDER.map((id) => ({ id, questions: questions.filter((q) => q.section === id) })).filter((s) => s.questions.length > 0);
  const g = answers.goals;
  const saved = first(params.saved);
  const editHref = (id: string) => `${PROFILE_QUIZ_HREF}?q=${encodeURIComponent(id)}&next=${encodeURIComponent(GOALS_EDITOR_HREF)}`;
  const continueHref = `${PROFILE_QUIZ_HREF}?next=${encodeURIComponent(GOALS_EDITOR_HREF)}`;
  const line = matchLabel(count, !progress.complete);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:py-8">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{pillLabel(progress)}</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">{profileName ?? "Your profile"}</h1>
          {savedProfiles.readable && !summary.teamMember && (
            <p className="mt-1 text-sm text-muted-foreground">
              {profileName ? "These answers are this profile’s; “About you” is shared by all your profiles. " : ""}
              <Link href="/profiles" className="font-medium text-foreground underline-offset-4 hover:underline">
                {profileName ? "Switch or manage profiles" : "Add a profile for another search or a client"}
              </Link>
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">{progress.types.length > 0 ? `Deals you want: ${describeTypes(progress.types)}. ` : ""}Every answer here shapes the deals we show you. Tap one to change it{progress.complete ? "" : ", or carry on where you left off"}.</p>
          {/* Batch 22d: plans changed? Clear this profile's answers (and, if they choose, its tracked deals) and answer again. */}
          {savedProfiles.readable && savedProfiles.active && (
            <p className="mt-1 text-sm text-muted-foreground">
              Plans changed?{" "}
              <Link href="/profile/start-again" className="font-medium text-foreground underline-offset-4 hover:underline">
                Start again
              </Link>
            </p>
          )}
          {first(params.mode) === "1" && (
            <p role="status" className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
              Saved. Today’s deals for this profile now follow it.
            </p>
          )}
          {first(params.mode) === "0" && (
            <p role="status" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              Could not save that switch. Please try again shortly.
            </p>
          )}
          {first(params.new) === "1" && (
            <p role="status" className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
              New profile created as a copy. Change whatever’s different: tap any answer below.
            </p>
          )}
          {line && <p className="mt-2 text-sm font-medium text-foreground">{line}. Changes count from your next Today’s 5.</p>}
          {!progress.complete && (
            <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile progress">
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="mt-2 text-sm text-foreground">
                {progress.percent}% done · {minutesLeftLabel(progress.minutesLeft)}
                {credit.pence > 0 && !credit.paid && credit.state !== "never" ? ` · £${(credit.pence / 100).toFixed(0)} of credit when you finish` : ""}
              </p>
              <Link href={continueHref} className="mt-3 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                Continue where you left off
              </Link>
            </div>
          )}
          {progress.complete && credit.line && <p className="mt-2 text-sm text-muted-foreground">{credit.line}</p>}
        </header>

        {sections.map((s) => (
          <section key={s.id} aria-labelledby={`profile-${s.id}`} className="rounded-xl border border-border bg-card">
            <h2 id={`profile-${s.id}`} className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {SECTION_TITLES[s.id]}
            </h2>
            <ul className="divide-y divide-border">
              {s.questions.map((q) => {
                const mark = quiz.answered[q.id];
                const label = mark?.notSure ? "Not sure" : answerLabel(q.id, answers);
                // Batch 14: the answer's switch, when this answer judges deals at all.
                const criterion = criterionForQuestion(q.id);
                const active = tailoring && criterion && switchedOn.has(criterion) && !mark?.notSure ? criterion : null;
                const mode = active && tailoring ? modeOf(active, tailoring) : null;
                return (
                  <li key={q.id} id={`q-${q.id}`} className="scroll-mt-4">
                    <Link href={editHref(q.id)} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{q.short}</span>
                        <span className={`block truncate text-sm ${label ? "text-muted-foreground" : "italic text-primary"}`}>{label ?? "Not answered yet"}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-primary">Change</span>
                    </Link>
                    {active && mode && isSwitchable(active) && (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
                        <span className="text-xs text-muted-foreground">{mode === "must" ? "Deals that miss this aren’t shown." : "Deals that miss this are shown lower down."}</span>
                        <FilterModeSwitch criterion={active} question={q.id} mode={mode} label={q.short} />
                      </div>
                    )}
                    {active === "motivation" && (
                      <p className="px-4 pb-3 text-xs text-muted-foreground">{mode === "must" ? "A must-have: deals from sellers who show no sign of it aren’t shown." : "A nice-to-have: motivated sellers are shown first."}</p>
                    )}
                    {NOT_APPLIED.includes(q.id) && label && !mark?.notSure && (
                      <p className="px-4 pb-3 text-xs text-muted-foreground">Listings don’t say this yet, so it doesn’t change which deals you see.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <section id="advanced" aria-labelledby="profile-advanced" className="rounded-xl border border-border bg-card">
          <h2 id="profile-advanced" className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Advanced
          </h2>
          <form action={saveAdvancedAction} className="space-y-4 px-4 py-4">
            <p className="text-sm text-muted-foreground">How the Market Explorer ranks areas as “your fit”, and how motivated-seller picks are judged. The quiz doesn’t ask these; the defaults suit most members.</p>
            {saved === "1" && <p className="rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary">Saved.</p>}
            {saved === "0" && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">Could not save. Please try again.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["p_yield", "Maximum yield", g.priorities.yield],
                  ["p_revenue", "Maximum revenue", g.priorities.revenue],
                  ["p_lowCompetition", "Low competition", g.priorities.lowCompetition],
                  ["p_directBookings", "Direct bookings", g.priorities.directBookings],
                ] as [string, string, Priority][]
              ).map(([name, label, value]) => (
                <label key={name} className="block text-sm">
                  <span className="font-medium text-foreground">{label}</span>
                  <select name={name} defaultValue={value} className="mt-1 h-11 w-full rounded-lg border border-border bg-input/50 px-3 text-sm">
                    {([0, 1, 2, 3] as Priority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {/* Batch 16b: the figures use an interest-only mortgage, so the term is hidden (the stored answer is kept; the repayment formula would read it). */}
              {DEFAULT_FINANCE.mortgageType === "repayment" ? (
                <label className="block text-sm">
                  <span className="font-medium text-foreground">Mortgage term (years)</span>
                  <input name="f_termYears" type="number" min={1} max={40} step={1} defaultValue={g.finance.termYears} className="mt-1 h-11 w-full rounded-lg border border-border bg-input/50 px-3 text-sm" />
                </label>
              ) : (
                <p className="block text-sm">
                  <span className="font-medium text-foreground">Mortgage term</span>
                  <span className="mt-1 block text-muted-foreground">Your figures use an interest-only mortgage, so no term applies.</span>
                </p>
              )}
              <label className="block text-sm">
                <span className="font-medium text-foreground">Target yield (%)</span>
                <input name="f_targetYieldPct" type="number" min={1} max={50} step={0.5} defaultValue={g.finance.targetYieldPct} className="mt-1 h-11 w-full rounded-lg border border-border bg-input/50 px-3 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-foreground">Seller or landlord</span>
                <select name="m_mode" defaultValue={g.motivation.mode} className="mt-1 h-11 w-full rounded-lg border border-border bg-input/50 px-3 text-sm">
                  {(Object.keys(MOTIVATION_MODE_LABELS) as MotivationMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MOTIVATION_MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-foreground">Counts as stuck after (months on the market)</span>
                <input name="m_minMonths" type="number" min={MIN_MONTHS_RANGE.min} max={MIN_MONTHS_RANGE.max} step={1} defaultValue={g.motivation.minMonthsOnMarket} className="mt-1 h-11 w-full rounded-lg border border-border bg-input/50 px-3 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-foreground">Counts as a long void after (weeks on the market)</span>
                <input name="m_minWeeks" type="number" min={MIN_WEEKS_RANGE.min} max={MIN_WEEKS_RANGE.max} step={1} defaultValue={g.motivation.minWeeksOnMarket} className="mt-1 h-11 w-full rounded-lg border border-border bg-input/50 px-3 text-sm" />
              </label>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="m_areaRelative" value="1" defaultChecked={g.motivation.areaRelative} className="mt-1 h-4 w-4" />
                <span className="text-foreground">Only count it as slow if it is also slower than the rest of that area.</span>
              </label>
            </div>
            <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Save advanced settings
            </button>
          </form>
        </section>

        <p className="text-xs text-muted-foreground">
          Your answers only decide which deals you see and in what order. See our{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
