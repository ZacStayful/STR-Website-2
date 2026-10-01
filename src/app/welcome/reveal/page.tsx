import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CreditProvider } from "@/components/credit/CreditProvider";
import { IntelligenceView } from "@/components/intelligence/IntelligenceView";
import { intelligenceCards } from "@/components/intelligence/cards";
import { WhatIfSuggestions } from "@/components/intelligence/WhatIfSuggestions";
import { profileSummaryFor } from "@/lib/profile/server";
import { quizPathFor } from "@/lib/auth/landing";
import { loadIntelligence } from "@/lib/intelligence/view-server";
import { isRevealMember, markRevealViewed, recordReveal, revealRowFor } from "@/lib/intelligence/reveal-server";
import { revealNext, revealStale } from "@/lib/intelligence/reveal";
import { todayKey } from "@/lib/today/day";
import { saveAllAction } from "./actions";

export const metadata: Metadata = {
  title: "Your matches — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * Batch 22, Part B: the signup reveal. A new member who has answered the
 * mandatory questions sees their best match right now and 2 alternatives:
 * Today's own first 3 cards for their primary profile, so tomorrow's Today
 * never repeats them. Outside AppShell (no header), with its own
 * CreditProvider for the out-of-credit window. Recorded before it renders.
 */
export default async function RevealPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; saved?: string | string[] }> }) {
  const params = await searchParams;
  const nextRaw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = revealNext(nextRaw);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent("/welcome/reveal")}`);

  const now = new Date();
  const summary = await profileSummaryFor(user.id);
  if (summary && !summary.teamMember && !summary.progress.mandatoryDone) redirect(quizPathFor(next));
  // Existing members (and team seats) never see the reveal.
  if (!summary || summary.teamMember || !(await isRevealMember(user.id, user.created_at))) redirect(next);

  const row = await revealRowFor(user.id);
  const today = todayKey(now);
  if (row?.viewedAt && revealStale(todayKey(new Date(row.viewedAt)), today)) redirect(next);

  const data = await loadIntelligence({ user, supabase, mode: "reveal", now });
  if (!row) {
    await recordReveal({ userId: user.id, profileId: data.profile?.id ?? null, day: today, dealIds: data.cards.map((c) => c.id), checked: data.choice?.checked ?? null, noMatch: data.tone === "none", level: data.level });
  }
  after(() => markRevealViewed(user.id, now));

  const cards = intelligenceCards(data, now);
  const unanswered = data.cards.filter((c) => !data.answered.has(c.id)).map((c) => c.id);
  const savedAll = (Array.isArray(params.saved) ? params.saved[0] : params.saved) === "all";
  // Part C: the notification choices come next, once; then where they were going.
  const continueHref = row?.choicesAt ? next : `/welcome/choices?next=${encodeURIComponent(next)}`;

  return (
    <CreditProvider initial={data.credit}>
      <IntelligenceView
        surface="reveal"
        continueHref={continueHref}
        continueLabel="Continue to Stayful Intelligence"
        level={data.level}
        levelName={data.levelName}
        nextLevel={data.nextLevel}
        tone={data.tone}
        cardCount={data.cards.length}
        checkedText={data.checkedText}
        best={cards[0] ?? null}
        alternatives={cards.slice(1)}
        savedAll={savedAll}
        saveAll={
          unanswered.length > 1 ? (
            <form action={saveAllAction} className="flex flex-col items-center gap-1 text-center">
              {unanswered.map((id) => (
                <input key={id} type="hidden" name="deal" value={id} />
              ))}
              <input type="hidden" name="back" value={`/welcome/reveal?next=${encodeURIComponent(next)}`} />
              <button type="submit" className="rounded-full bg-[#B9D5C6] px-5 py-2 text-sm font-semibold text-[#1a2118] hover:opacity-90">
                Save all {unanswered.length}
              </button>
              <span className="text-xs text-[#B9D5C6]">Save to my deals — I’ll tell you if the price drops, it comes back on the market, it’s getting attention or it’s gone.</span>
            </form>
          ) : null
        }
        whatIfs={data.whatIfs ? <WhatIfSuggestions items={data.whatIfs.items} none={data.whatIfs.none} surface="reveal" changeHref={`/welcome?q=budget&next=${encodeURIComponent(`/welcome/reveal?next=${encodeURIComponent(next)}`)}`} /> : undefined}
        answers={data.answers}
      />
    </CreditProvider>
  );
}
