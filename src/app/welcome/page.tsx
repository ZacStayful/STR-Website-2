import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureWelcomeGrant } from "@/lib/credit/welcome";
import { quizPathFor, welcomeReturnPath } from "@/lib/auth/landing";
import { GOALS_EDITOR_HREF, NAV_TARGETS } from "@/lib/nav";
import { rankedAreasForQuiz } from "@/lib/onboarding/server";
import { isQuestionId, questionsFor } from "@/lib/profile/questions";
import { isRevealMember } from "@/lib/intelligence/reveal-server";
import { ThinkingBackgroundMount } from "./_components/ThinkingBackgroundMount";
import { accuracySettings, creditViewFor, markQuizOpened, matchCountFor, profileSummaryFor, progressView } from "@/lib/profile/server";
import { VisitHeartbeat } from "@/components/activity/VisitHeartbeat";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { MembersFooter } from "@/components/feedback/MembersFooter";
import { SignOutForm } from "@/app/account/AccountSections";
import { bannerEnabled } from "@/lib/meta/env";
import { isTeamBound } from "@/lib/team";
import { quizCheckboxShown } from "@/lib/tracking/consent";
import { deviceConsent, memberConsentFor } from "@/lib/tracking/consent-server";
import { starterPackStateFor } from "@/lib/starter-pack/server";
import { hasRestartFor } from "@/lib/profiles/server";
import { Quiz } from "./Quiz";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your profile — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * The profile quiz (Batch 12): one question per screen, saved as they go.
 * Every members-only page sends a member here until the three mandatory
 * questions are answered (AppShell → requireProfileStart), with `?next=` as
 * the way back; after that the member comes back through the Today card,
 * the header pill, the profile page or the daily email, and resumes at the
 * next unanswered question. `?q=<id>` opens one question to change it, then
 * returns to `?next=` (the profile page). Complete and nothing to change:
 * straight to the profile page.
 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; q?: string | string[] }> }) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const returnTo = welcomeReturnPath(first(params.next));
  const q = first(params.q);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/welcome");

  // Members' pages grant the welcome credit on first visit; this may be that
  // visit, and the postcode question spends a little of it on geocoding.
  await ensureWelcomeGrant(user.id, user.email ?? null).catch((err) => console.error("[welcome] welcome grant failed:", err));

  const summary = await profileSummaryFor(user.id);
  // The profile cannot be read (schema not run): never trap anyone here.
  if (!summary) redirect(returnTo);

  const editing = q && isQuestionId(q) && questionsFor(summary.answers).some((x) => x.id === q) ? q : null;
  if (!editing && summary.progress.complete) redirect(GOALS_EDITOR_HREF);

  const now = new Date();
  const [areas, matchCount, credit, levelSettings] = await Promise.all([rankedAreasForQuiz(), matchCountFor({ userId: user.id, email: user.email ?? null, answers: summary.answers }), creditViewFor(summary), accuracySettings()]);
  if (!editing) await markQuizOpened(user.id, summary, now);

  // Batch 19: a new Google sign-up never saw the sign-up form's Meta pixel
  // checkbox, so the start screen offers it (only looked up when it could show).
  const fresh = !editing && summary.progress.answered.length === 0;
  const google = user.app_metadata?.provider === "google";
  const consentCheckbox =
    fresh && google && bannerEnabled()
      ? quizCheckboxShown({
          enabled: true,
          fresh,
          google,
          teamSeat: await isTeamBound(user.id, user.email ?? null),
          memberChoice: (await memberConsentFor(user.id))?.choice ?? null,
          deviceChoice: (await deviceConsent())?.choice ?? null,
        })
      : false;

  // Batch 22: a new member goes from the last answer (or "Finish later") straight to their signup reveal.
  // Batch 22d: never after Start again or Start blank (no signup reveal, no house spend on a restart).
  const revealHref = !editing && !summary.teamMember && (await isRevealMember(user.id, user.created_at)) && !(await hasRestartFor(user.id)) ? `/welcome/reveal?next=${encodeURIComponent(returnTo)}` : null;

  // Batch 20: the starter pack, offered as the welcome questions are finished (only looked up when it could show).
  const packState = !editing && !summary.teamMember && !summary.progress.mandatoryDone ? await starterPackStateFor(user.id) : null;
  const pack = packState?.offer.eligible ? { copy: packState.copy, returnTo: quizPathFor(returnTo) } : null;

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:py-12">
      <VisitHeartbeat />
      {/* Batch 22: the thinking background, new members only and never while changing one answer. */}
      {revealHref && <ThinkingBackgroundMount />}
      <div className="relative z-10 mx-auto w-full max-w-lg">
        <Quiz
          answers={summary.answers}
          progress={progressView(summary.progress, levelSettings)}
          matchCount={matchCount}
          credit={credit}
          editing={editing}
          returnTo={returnTo}
          fresh={fresh}
          consentCheckbox={consentCheckbox}
          areas={areas}
          pack={pack}
          revealHref={revealHref}
          profileHref={GOALS_EDITOR_HREF}
          privacyHref="/privacy"
          todayHref={NAV_TARGETS.today.href}
        />
      </div>
      {/* Batch 18: the quiz is the first screen a new member sees, so they can tell us if it goes wrong. */}
      {/* The quiz gates /account, where Sign out lives, so it is offered here too: a member who signed in on the wrong account, or a shared phone, is not stuck. */}
      <div className="mx-auto mt-10 w-full max-w-lg">
        <MembersFooter />
        <SignOutForm />
      </div>
      <FeedbackDialog />
    </main>
  );
}
