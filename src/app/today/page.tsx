import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { payerFor } from "@/lib/team";
import { isAdminEmail } from "@/lib/admin";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { parseMarketGoals } from "@/lib/market/goals";
import { countDeals, dealCardsByIds, earlyAccessCount, openedDealIds, photoUrlFor, recordShown } from "@/lib/marketplace/queries";
import { earlyAccessBanner, earlyAccessFor } from "@/lib/marketplace/early-access";
import { reactionsFor } from "@/lib/marketplace/reactions-server";
import { dealVisibilityFor } from "@/lib/marketplace/tier";
import { filtersForGoals } from "@/lib/today/candidates";
import { displayOrder, greeting, matchLine } from "@/lib/today/day";
import { todaySelection, todaysPick, type TodaysPick } from "@/lib/today/selection";
import { syncChecklist } from "@/lib/today/checklist-server";
import { DealCard } from "@/app/deals/_components/DealCard";
import { EarlyAccessBanner } from "@/app/deals/_components/EarlyAccessBanner";
import { ShareDealButton } from "@/app/deals/_components/ShareDealButton";
import { Checklist, ChecklistProvider } from "./_components/Checklist";
import { PasteLinkBox } from "./_components/PasteLinkBox";
import { TodayCards } from "./_components/TodayCards";

export const metadata: Metadata = {
  title: "Today — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const EDIT_GOALS = "/markets?goals=1";

/**
 * The first screen a member sees each day: up to five deals picked for them,
 * this morning's pick first, triaged with Keep and Pass until they are done
 * for the day. The list is chosen once a day and stored, so it does not move
 * under them between visits or devices.
 */
export default async function TodayPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const now = new Date();
  const adminUser = isAdminEmail(user.email);
  const [payer, visibility, profileRes, savedRes, settings] = await Promise.all([
    payerFor(user.id),
    // An account that has never paid sees a deal only once its early-access window has passed.
    dealVisibilityFor(user.id, adminUser),
    supabase.from("profiles").select("full_name, market_goals").eq("id", user.id).maybeSingle(),
    supabase.from("saved_areas").select("postcode_area").eq("user_id", user.id),
    getBillingSettings(),
  ]);
  const profile = profileRes.data as { full_name: string | null; market_goals: unknown } | null;
  const goals = parseMarketGoals(profile?.market_goals ?? null);
  const savedAreas = ((savedRes.data ?? []) as { postcode_area: string }[]).map((r) => r.postcode_area);
  // The search the member's goals point at: the same one /deals counts, so "N match" and the cards agree.
  const filters = filtersForGoals(goals, savedAreas);

  const [selection, pick, count, waiting, checklist] = await Promise.all([
    todaySelection({ userId: user.id, payerId: payer.payerId, goals, savedAreas, visibility }, now),
    todaysPick(user.id, now),
    countDeals(filters, visibility, { userId: user.id }),
    visibility.tier === "free" ? earlyAccessCount(filters, visibility) : Promise.resolve(null),
    // The first-week checklist, brought up to date now: any "+£1" it shows is marked seen.
    syncChecklist(user.id, { markSeen: true, now }),
  ]);

  const stored = selection?.dealIds ?? [];
  const pickDealId = pick?.dealId ?? null;
  const answered = await reactionsFor(user.id, pickDealId ? [pickDealId, ...stored] : stored);
  const order = displayOrder(stored, pickDealId, new Set(answered.keys()));
  const cards = await dealCardsByIds(order, visibility);
  const opened = await openedDealIds(payer.payerId, cards.map((c) => c.id));
  const pickCard = pickDealId ? cards.find((c) => c.id === pickDealId) ?? null : null;
  const dayCards = cards.filter((c) => c.id !== pickDealId);
  const ids = cards.map((c) => c.id);
  const initial = Object.fromEntries(ids.filter((id) => answered.has(id)).map((id) => [id, answered.get(id)!]));

  // What this member was shown goes to the front of the recheck queue.
  if (ids.length > 0) after(() => recordShown(ids));

  const banner = earlyAccessBanner(waiting, false);
  const line = matchLine(count, goals !== null);
  const card = (c: (typeof cards)[number]) => (
    <DealCard
      key={c.id}
      card={c}
      photoUrl={photoUrlFor(c, now)}
      ladder={settings.dealOpenLadder}
      now={now}
      opened={opened.has(c.id)}
      reaction={answered.get(c.id) ?? null}
      earlyAccess={visibility.tier === "paid" ? earlyAccessFor(c.live_since, settings.freeDealDelayHours, now) : null}
      share={<ShareDealButton dealId={c.id} />}
    />
  );

  return (
    <main className="min-h-screen bg-background">
      <ChecklistProvider initial={checklist}>
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:py-8">
        <Checklist />

        <header>
          <h1 className="text-2xl font-bold text-foreground">{greeting(now, profile?.full_name ?? null)}</h1>
          {line && <p className="mt-1 text-sm text-muted-foreground">{line}</p>}
          {!goals && (
            <p className="mt-2 text-sm text-foreground">
              <Link href={EDIT_GOALS} className="font-semibold underline-offset-4 hover:underline">
                Tell us what you’re looking for
              </Link>{" "}
              and today’s deals will be picked for you.
            </p>
          )}
        </header>

        <PasteLinkBox />

        {ids.length > 0 ? (
          <TodayCards ids={ids} initial={initial}>
            <div className="space-y-5">
              {pickCard && (
                <section aria-labelledby="todays-pick">
                  <h2 id="todays-pick" className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Today’s pick · from this morning’s email</h2>
                  <ul className="grid gap-4">{card(pickCard)}</ul>
                </section>
              )}
              {!pickCard && pick && <OutsidePick pick={pick} />}
              {dayCards.length > 0 && (
                <section aria-labelledby="todays-deals">
                  <h2 id="todays-deals" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {selection?.nearMiss ? "The closest we found" : pickCard ? "More picked for you today" : "Picked for you today"}
                  </h2>
                  {selection?.nearMiss && (
                    <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                      <p className="font-semibold text-foreground">Not an exact match</p>
                      {selection.advice && <p className="mt-0.5 text-foreground">{selection.advice}</p>}
                      <Link href={EDIT_GOALS} className="mt-1 inline-block font-medium text-foreground underline-offset-4 hover:underline">
                        Edit what you’re looking for
                      </Link>
                    </div>
                  )}
                  <ul className="grid gap-4 sm:grid-cols-2">{dayCards.map(card)}</ul>
                </section>
              )}
            </div>
          </TodayCards>
        ) : (
          <>
            {pick && <OutsidePick pick={pick} />}
            <EmptyDay hasGoals={goals !== null} ready={selection !== null} />
          </>
        )}

        <EarlyAccessBanner text={banner} returnTo="/today" />

        <nav aria-label="More" className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-4 text-sm">
          <Link href="/deals" className="font-medium text-foreground underline-offset-4 hover:underline">Browse all deals</Link>
          <Link href="/markets" className="font-medium text-foreground underline-offset-4 hover:underline">Area rankings &amp; map</Link>
          <Link href="/picks" className="font-medium text-foreground underline-offset-4 hover:underline">Past picks</Link>
        </nav>
      </div>
      </ChecklistProvider>
    </main>
  );
}

/** A daily pick found outside the marketplace pool: no deal sheet to draw, so a line and a way to it. */
function OutsidePick({ pick }: { pick: TodaysPick }) {
  const what = [pick.bedrooms ? `${pick.bedrooms}-bed` : null, pick.kind === "rent" ? "to rent" : "to buy", pick.areaName ? `in ${pick.areaName}` : null].filter(Boolean).join(" ");
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Today’s pick · from this morning’s email</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{what}</p>
      {pick.price && <p className="text-sm text-muted-foreground">{pick.price}</p>}
      <Link href="/picks" className="mt-2 inline-block text-sm font-medium text-foreground underline-offset-4 hover:underline">
        See it in your picks
      </Link>
    </section>
  );
}

function EmptyDay({ hasGoals, ready }: { hasGoals: boolean; ready: boolean }) {
  return (
    <section className="rounded-xl border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium text-foreground">{ready ? "Nothing new for you today." : "Today’s deals aren’t ready yet."}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {hasGoals ? (
          <>
            New deals arrive every morning.{" "}
            <Link href={EDIT_GOALS} className="font-medium text-foreground underline-offset-4 hover:underline">
              Widen what you’re looking for
            </Link>{" "}
            or browse every deal.
          </>
        ) : (
          "New deals arrive every morning. Browse every deal in the meantime."
        )}
      </p>
    </section>
  );
}
