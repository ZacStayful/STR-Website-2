import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureWelcomeGrant } from "@/lib/credit/welcome";
import { welcomeReturnPath, HOME_PATH } from "@/lib/auth/landing";
import { GOALS_EDITOR_HREF } from "@/lib/nav";
import { rankedAreasForQuiz } from "@/lib/onboarding/server";
import { isQuestionId, questionsFor } from "@/lib/profile/questions";
import { creditViewFor, markQuizOpened, matchCountFor, profileSummaryFor, progressView } from "@/lib/profile/server";
import { VisitHeartbeat } from "@/components/activity/VisitHeartbeat";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { MembersFooter } from "@/components/feedback/MembersFooter";
import { bannerEnabled } from "@/lib/meta/env";
import { isTeamBound } from "@/lib/team";
import { quizCheckboxShown } from "@/lib/tracking/consent";
import { deviceConsent, memberConsentFor } from "@/lib/tracking/consent-server";
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
  const [areas, matchCount, credit] = await Promise.all([rankedAreasForQuiz(), matchCountFor({ userId: user.id, email: user.email ?? null, answers: summary.answers }), creditViewFor(summary)]);
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

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:py-12">
      <VisitHeartbeat />
      <div className="mx-auto w-full max-w-lg">
        <Quiz
          answers={summary.answers}
          progress={progressView(summary.progress)}
          matchCount={matchCount}
          credit={credit}
          editing={editing}
          returnTo={returnTo}
          fresh={fresh}
          consentCheckbox={consentCheckbox}
          areas={areas}
          profileHref={GOALS_EDITOR_HREF}
          privacyHref="/privacy"
          todayHref={HOME_PATH}
        />
      </div>
      {/* Batch 18: the quiz is the first screen a new member sees, so they can tell us if it goes wrong. */}
      <div className="mx-auto mt-10 w-full max-w-lg">
        <MembersFooter />
      </div>
      <FeedbackDialog />
    </main>
  );
}
