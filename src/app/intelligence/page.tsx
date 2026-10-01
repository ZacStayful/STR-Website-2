import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CreditProvider } from "@/components/credit/CreditProvider";
import { IntelligenceView } from "@/components/intelligence/IntelligenceView";
import { intelligenceCards } from "@/components/intelligence/cards";
import { WhatIfSuggestions } from "@/components/intelligence/WhatIfSuggestions";
import { SearchProgress } from "@/components/intelligence/SearchProgress";
import { DeepSearchOffer } from "@/components/intelligence/DeepSearchOffer";
import { requireProfileStart } from "@/lib/profile/server";
import { loadIntelligence } from "@/lib/intelligence/view-server";
import { logActivity } from "@/lib/activity/log";
import { todayKey } from "@/lib/today/day";

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
export default async function IntelligencePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/intelligence");
  await requireProfileStart(user.id, "/intelligence");

  const now = new Date();
  const data = await loadIntelligence({ user, supabase, mode: "header", now });
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
            {data.deepQuote && <DeepSearchOffer aboutBasePence={data.deepQuote.aboutBasePence} upToBasePence={data.deepQuote.upToBasePence} firstDiscount={data.deepQuote.firstDiscount} surface="header" />}
          </>
        }
        answers={data.answers}
      />
    </CreditProvider>
  );
}
