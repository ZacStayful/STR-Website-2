import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { GOALS_EDITOR_HREF } from "@/lib/nav";
import { creditViewFor, profileSummaryFor } from "@/lib/profile/server";
import { profilesFor, resetChoicesFor } from "@/lib/profiles/server";
import { labelsShown } from "@/lib/profiles/rules";
import { dealSummary } from "@/app/my-deals/_lib/rows";
import { startAgainAction } from "../actions";
import { DealsChoice } from "./_components/DealsChoice";

export const metadata: Metadata = {
  title: "Start again — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * Batch 22d: "Start again" for the active saved profile. One screen: which
 * answers to forget, and what happens to the deals tracked for this profile.
 * Confirming goes straight into the quiz (src/app/profile/actions.ts).
 */
export default async function StartAgainPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const params = await searchParams;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/profile/start-again");

  const [choices, summary, saved] = await Promise.all([resetChoicesFor(user.id, isAdminEmail(user.email)), profileSummaryFor(user.id), profilesFor(user.id)]);
  if (!choices.readable || !choices.active || !choices.load || !summary) redirect(GOALS_EDITOR_HREF);
  const credit = await creditViewFor(summary);
  const load = choices.load;
  const deals = choices.deals.map((d) => dealSummary(d, load));
  const name = labelsShown(saved.all) ? choices.active.name : null;
  const several = saved.live.length > 1;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:py-8">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{name ?? "Your profile"}</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Start again?</h1>
          <p className="mt-1 text-sm text-muted-foreground">I’ll forget the answers you choose and ask the questions again. Your credit and plan don’t change.</p>
        </header>

        {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        <form action={startAgainAction} className="space-y-5">
          <fieldset className="space-y-2 rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your answers</legend>
            <label className="flex items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name="answers" value="search" defaultChecked className="mt-1 h-4 w-4" />
              <span>
                <span className="block text-sm font-medium text-foreground">Clear my search answers only</span>
                <span className="block text-xs text-muted-foreground">Deal types, budgets, areas, profit, finance and this profile’s other answers and settings. “About you” stays.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name="answers" value="everything" className="mt-1 h-4 w-4" />
              <span>
                <span className="block text-sm font-medium text-foreground">Clear everything</span>
                <span className="block text-xs text-muted-foreground">
                  The above, plus “About you”.{several ? " “About you” is shared, so this changes it for all your saved profiles." : " “About you” is shared by every saved profile you make."}
                </span>
              </span>
            </label>
          </fieldset>

          <fieldset className="space-y-2 rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deals you’re tracking for this profile · {deals.length}</legend>
            {!choices.tagsReadable ? (
              <>
                <input type="hidden" name="deals" value="keep_all" />
                <p className="text-sm text-muted-foreground">Your tracked deals can’t be read right now, so they’ll all be kept. You can clear them later.</p>
              </>
            ) : deals.length === 0 ? (
              <>
                <input type="hidden" name="deals" value="keep_all" />
                <p className="text-sm text-muted-foreground">You’re not tracking any deals for this profile.</p>
              </>
            ) : (
              <>
                <DealsChoice deals={deals} />
                <p className="pt-1 text-xs text-muted-foreground">Cleared deals leave My deals but aren’t deleted. You can bring them back from “Cleared deals” for 30 days. Clearing isn’t a Pass, and deals you’ve opened stay opened.</p>
              </>
            )}
          </fieldset>

          <div className="space-y-1 text-sm text-muted-foreground">
            <p>What Today has learned from your Keeps, Passes and opens starts fresh for this profile.</p>
            {!summary.teamMember && credit.paid && <p>You’ve already had your £{(credit.pence / 100).toFixed(credit.pence % 100 === 0 ? 0 : 2)} for completing your profile, so there’s none for answering again.</p>}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Start again
            </button>
            <Link href={GOALS_EDITOR_HREF} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
