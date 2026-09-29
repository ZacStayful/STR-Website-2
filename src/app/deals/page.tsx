import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { payerFor } from "@/lib/team";
import { isAdminEmail } from "@/lib/admin";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { barsText } from "@/lib/listing/screen";
import { parseDealFilters, type DealFilters } from "@/lib/marketplace/grid";
import { MY_DEALS_PASSED_HREF, NAV_TARGETS, dealsViewRedirect } from "@/lib/nav";
import { listDeals, liveCountsByArea, recordShown, photoUrlFor, openedDealIds, countFor, countDeals, earlyAccessCount, type DealPage } from "@/lib/marketplace/queries";
import { earlyAccessBanner, earlyAccessFor, isFiltered } from "@/lib/marketplace/early-access";
import { reactionsFor } from "@/lib/marketplace/reactions-server";
import { dealVisibilityFor } from "@/lib/marketplace/tier";
import { cameFromWelcome } from "@/lib/onboarding/deal-filters";
import { cardViewsFor } from "@/lib/marketplace/card-state";
import { cashBuyerOf } from "@/lib/marketplace/most-you-can-pay";
import { parseMarketGoals } from "@/lib/market/goals";
import { getAreaCardsWithin } from "@/lib/market/cached";
import { profilesFor } from "@/lib/profiles/server";
import { tailoringForMember } from "@/lib/tailoring/server";
import { withTailoring } from "@/lib/tailoring/numbers";
import { bestForYouPage, type BestPage } from "@/lib/tailoring/browse-server";
import { TAILORING } from "@/lib/tailoring/config";
import { DealCard } from "./_components/DealCard";
import { GoalsStrip } from "./_components/GoalsStrip";
import { DealsFilterBar } from "./_components/DealsFilterBar";
import { EarlyAccessBanner } from "./_components/EarlyAccessBanner";
import { ShareDealButton } from "./_components/ShareDealButton";
import { DealsMap } from "./_components/DealsMap";
import { Pagination } from "./_components/Pagination";

/** How long the page waits for the market snapshot for the cards' area figures; without it they fall back. */
const AREA_WAIT_MS = 2_000;

export const metadata: Metadata = {
  title: "Deals — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const MESSAGES: Record<string, string> = {
  gone: "That deal has gone off the market.",
  missing: "We could not find that deal.",
};

/**
 * The marketplace grid: every live deal that clears the income screening,
 * with the figures free to see and the address behind a paid open. Filters
 * live in the URL; the server re-queries on every change.
 *
 * The member's kept and passed deals live on My deals (Batch 11): an old
 * ?view=kept or ?view=passed link goes there before anything is read.
 */
export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const parsed = parseDealFilters(raw);
  const moved = dealsViewRedirect(parsed.view);
  if (moved) redirect(moved);
  // The grid is always the default view: every live deal except the ones they passed.
  const filters: DealFilters = { ...parsed, view: "all" };
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // An account that has never paid sees a deal 48 hours (free_deal_delay_hours) after it went live.
  const visibility = await dealVisibilityFor(user.id, isAdminEmail(user.email));
  const now = new Date();
  const adminUser = isAdminEmail(user.email);
  // The market snapshot, for the cards' area figures and the "Best for you" order: waited on briefly, never built here.
  const snapshotReady = getAreaCardsWithin(AREA_WAIT_MS);
  // The member's answers: the active profile's tailoring (Batch 14) orders "Best for you" and picks each card's three numbers.
  const answersReady = Promise.all([supabase.from("profiles").select("market_goals").eq("id", user.id).maybeSingle(), supabase.from("saved_areas").select("postcode_area").eq("user_id", user.id), profilesFor(user.id)]).then(async ([{ data: profile }, savedRes, savedProfiles]) => {
    const goals = parseMarketGoals(profile?.market_goals);
    const savedAreas = ((savedRes.data ?? []) as { postcode_area: string }[]).map((r) => r.postcode_area);
    const active = savedProfiles.readable ? savedProfiles.active : null;
    return { goals, profileId: active?.id ?? null, tailoring: await tailoringForMember(user.id, active, goals, savedAreas, now) };
  });
  // The member's own passes shape the grid: a passed deal leaves it (and is on My deals, under Passed).
  // "Best for you" (the default): the member's own order; on any failure, the grid's own query by profit, so Browse never goes blank.
  const pageReady: Promise<BestPage | DealPage> =
    filters.sort === "best"
      ? Promise.all([answersReady, snapshotReady]).then(async ([a, cards]) => (await bestForYouPage(filters, visibility, { userId: user.id, profileId: a.profileId, goals: a.goals, tailoring: a.tailoring }, cards)) ?? listDeals({ ...filters, sort: "profit" }, visibility, { userId: user.id }))
      : listDeals(filters, visibility, { userId: user.id });
  // Early access: a free member gets one line with the real count of deals they are waiting on (matching this search); a paying member gets a badge on each of those deals.
  const [page, counts, settings, waiting, { goals, tailoring }, snapshot] = await Promise.all([
    pageReady,
    liveCountsByArea(visibility.hourCutoffIso),
    getBillingSettings(),
    visibility.tier === "free" ? earlyAccessCount(filters, visibility) : Promise.resolve(null),
    answersReady,
    snapshotReady,
  ]);
  const ids = page.cards.map((c) => c.id);
  // Batch 10: each card's profit range at this member's finance, and its buttons at their price.
  const [opened, reactions, baseViews] = await Promise.all([
    openedDealIds((await payerFor(user.id)).payerId, ids),
    reactionsFor(user.id, ids),
    cardViewsFor({ supabase, userId: user.id, adminUser, cards: page.cards, finance: goals?.finance ?? null, cashBuyer: cashBuyerOf(goals) }),
  ]);
  const capped = "capped" in page && page.capped;
  // "Best for you" orders at most TAILORING.poolLimit deals; the counts still say how many match.
  const matching = capped ? (await countDeals(filters, visibility, { userId: user.id })) ?? page.total : page.total;
  const views = withTailoring(baseViews, page.cards, tailoring, snapshot, now);
  // Nothing left in the grid: say so if it is because they passed on all of it.
  const passedHere = page.total === 0 ? await countDeals({ ...filters, view: "passed" }, visibility, { userId: user.id }) : null;
  const countMap: Record<string, number> = {};
  for (const c of counts) countMap[c.code] = countFor(counts, c.code, filters.kind);
  const message = typeof raw.msg === "string" ? MESSAGES[raw.msg] ?? null : null;
  const banner = earlyAccessBanner(waiting, isFiltered(filters));
  const totalLive = counts.reduce((n, c) => n + c.total, 0);

  // What this member was shown goes to the front of the recheck queue.
  after(() => recordShown(ids));

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Deals</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every listing on the market in Stayful’s top areas that nets {barsText(settings.r2rQualifiedProfit)}. Profit is an area estimate at your finance: take a Quick look for the address, photos and listing link, or a Full analysis for the exact figures for the property.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={NAV_TARGETS.myDeals.href} className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Your kept deals</Link>
            <Link href="/deals/opened" className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">My opened deals</Link>
          </div>
        </div>

        {message && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{message}</p>}

        <GoalsStrip total={matching} fromWelcome={cameFromWelcome(raw.from)} />
        <EarlyAccessBanner text={banner} />
        <DealsFilterBar filters={filters} counts={counts} total={matching} />

        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            {page.cards.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                {passedHere ? (
                  <>
                    <p className="text-sm font-medium text-foreground">You’ve passed on every deal that matches.</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <Link href={MY_DEALS_PASSED_HREF} className="font-medium text-foreground underline-offset-4 hover:underline">See your passed deals in My deals</Link> or widen the filter. New deals arrive every morning.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">{totalLive === 0 ? "The marketplace is filling up." : "Nothing matches that filter yet."}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {totalLive === 0 ? "The first sweep runs each morning and new deals go live once we have checked their listing page. Check back tomorrow." : "Try a wider price range, another area, or drop the profit floor. New deals arrive every morning."}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {page.cards.map((card) => (
                  <DealCard key={card.id} card={card} photoUrl={photoUrlFor(card, now)} ladder={settings.dealOpenLadder} now={now} opened={opened.has(card.id)} reaction={reactions.get(card.id) ?? null} earlyAccess={visibility.tier === "paid" ? earlyAccessFor(card.live_since, settings.freeDealDelayHours, now) : null} share={<ShareDealButton dealId={card.id} />} view={views.get(card.id)} />
                ))}
              </ul>
            )}
            {capped && <p className="mt-3 text-xs text-muted-foreground">Showing your best {TAILORING.poolLimit.toLocaleString("en-GB")} for this search. Narrow the filters to see the rest.</p>}
            <Pagination filters={{ ...filters, page: page.page }} total={page.total} pages={page.pages} />
          </section>
          <aside className="order-first lg:order-none">
            <DealsMap counts={countMap} filters={filters} />
            <p className="mt-2 text-[11px] text-muted-foreground">Prices and rents are the listing’s own. Short-let income is Stayful’s estimate for the area and size; long-let figures come from our own reports or a national table where marked. Nothing here is a guarantee.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
