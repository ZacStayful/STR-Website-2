import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CreditProvider } from "@/components/credit/CreditProvider";
import { IntelligenceView } from "@/components/intelligence/IntelligenceView";
import { intelligenceCards } from "@/components/intelligence/cards";
import { WhatIfSuggestions } from "@/components/intelligence/WhatIfSuggestions";
import { SearchProgress } from "@/components/intelligence/SearchProgress";
import { DeepSearchOffer } from "@/components/intelligence/DeepSearchOffer";
import { RevealAnalyses } from "@/components/intelligence/RevealAnalyses";
import { AutoTopupOffer } from "@/components/intelligence/AutoTopupOffer";
import { requireProfileStart } from "@/lib/profile/server";
import { loadIntelligence } from "@/lib/intelligence/view-server";
import { logActivity } from "@/lib/activity/log";
import { todayKey } from "@/lib/today/day";
import { chatUi } from "@/lib/chat/turns-server";
import { MAX_QUESTION_CHARS } from "@/lib/chat/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * Batch 22, Part E: the header eye opens this — the Stayful Intelligence view
 * with Today's top 3 for the active profile and the question chips. For every
 * member; opening it is recorded, never counted.
 */
export default async function IntelligencePage({ searchParams }: { searchParams: Promise<{ resume?: string | string[]; ask?: string | string[] }> }) {
  const params = await searchParams;
  // Batch 26: "Ask in the full view" from the quick box carries the question over; it is never sent for them.
  const askRaw = Array.isArray(params.ask) ? params.ask[0] : params.ask;
  const ask = typeof askRaw === "string" ? askRaw.slice(0, MAX_QUESTION_CHARS) : "";
  const resumeRaw = Array.isArray(params.resume) ? params.resume[0] : params.resume;
  const resumeId = resumeRaw && /^[0-9a-f-]{36}$/i.test(resumeRaw) ? resumeRaw : null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/intelligence");
  await requireProfileStart(user.id, "/intelligence");

  const now = new Date();
  const [data, chat] = await Promise.all([loadIntelligence({ user, supabase, mode: "header", now }), chatUi()]);
  logActivity(user.id, "si_view", { extras: { surface: "header", step: "open" }, dedupeKey: `si_view:header:${todayKey(now)}` });
  const cards = intelligenceCards(data, now);

  return (
    <CreditProvider initial={data.credit}>
      <IntelligenceView
        surface="header"
        continueHref="/today"
        continueLabel="Back to Today"
        level={data.level}
        levelName={data.levelName}
        nextLevel={data.nextLevel}
        tone={data.tone}
        cardCount={data.cards.length}
        checkedText={data.checkedText}
        best={cards[0] ?? null}
        alternatives={cards.slice(1)}
        whatIfs={data.whatIfs ? <WhatIfSuggestions items={data.whatIfs.items} none={data.whatIfs.none} surface="header" changeHref={`/welcome?q=budget&next=${encodeURIComponent("/intelligence")}`} /> : undefined}
        note={
          <>
            <SearchProgress running={data.searching} />
            <RevealAnalyses
              resumeId={resumeId}
              returnPath={"/intelligence"}
              items={data.cards
                .filter((c) => data.analyses.has(c.id))
                .map((c) => ({ dealId: c.id, title: [c.bedrooms ? `${c.bedrooms}-bed` : null, c.town ?? c.postcode_area].filter(Boolean).join(" · ") || "This deal", ...data.analyses.get(c.id)! }))}
            />
            <AutoTopupOffer amountPence={data.settings.intelligence.revealAutoTopupAmountPence} thresholdPence={data.settings.intelligence.revealAutoTopupThresholdPence} />
            {data.deepQuote && <DeepSearchOffer aboutBasePence={data.deepQuote.aboutBasePence} upToBasePence={data.deepQuote.upToBasePence} firstDiscount={data.deepQuote.firstDiscount} surface="header" />}
          </>
        }
        answers={data.answers}
        chat={chat ? { hintPence: chat.fullHintPence, floorPence: chat.fullFloorPence, initialQuestion: ask, voice: chat.voice } : undefined}
      />
    </CreditProvider>
  );
}
