import type { Metadata } from "next";
import { getAreaCards } from "@/lib/market/cached";
import { getMarketAccess, requireMarketAccess } from "@/lib/market/gate";
import { siteUrl } from "@/lib/url";
import { MarketExplorerProductPage } from "./_components/product/MarketExplorerProductPage";
import { ExplorerShell } from "./_components/explorer/ExplorerShell";
import { loadExplorerUser } from "./_lib/loadExplorerUser";
import { isSortKey } from "@/lib/market/rank";

// Signed-out visitors get the public, indexable product page at this URL;
// members get the explorer, which stays out of search.
export async function generateMetadata(): Promise<Metadata> {
  const { state } = await getMarketAccess();
  if (state !== "ok") {
    return {
      title: { absolute: "Market Explorer — Find the UK Areas Where Short-Lets Pay | Stayful" },
      description:
        "Every UK postcode area ranked by real short-term rental performance: revenue, occupancy, yield-on-cost, competition, licensing and direct-booking potential, tailored to your goals. Included with every Stayful trial.",
      alternates: { canonical: siteUrl("/markets") },
      openGraph: {
        title: "Stayful Market Explorer — find the UK areas where short-lets pay",
        description: "Every UK area ranked by real short-term rental performance, tailored to your investment goals.",
        url: siteUrl("/markets"),
      },
    };
  }
  return {
    title: "Market Explorer — UK Short-Term Rental Areas Ranked",
    description: "Every UK area ranked by short-term rental performance, competition, licensing and direct-booking potential, tailored to your goals.",
    robots: { index: false, follow: false },
    alternates: { canonical: siteUrl("/markets") },
  };
}

export default async function MarketsPage({ searchParams }: { searchParams: Promise<{ sort?: string; q?: string }> }) {
  // Members only. Signed-out visitors get the public product page; blocked
  // users are redirected to /upgrade; nothing below runs for either.
  if ((await requireMarketAccess("/markets")) === "anon") return <MarketExplorerProductPage />;

  const access = await getMarketAccess();
  const [{ sort, q }, cards, user] = await Promise.all([searchParams, getAreaCards(), loadExplorerUser(access.user)]);

  if (cards.length === 0) {
    return (
      <div className="mx-container">
        <div className="mx-empty" style={{ marginTop: 40 }}>
          <h2>Market data is loading</h2>
          <p>We couldn’t load area data right now — please try again shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <ExplorerShell
      cards={cards}
      goals={user.goals}
      savedAreas={user.savedAreas}
      userEmail={user.email}
      initialSort={isSortKey(sort) ? sort : "stayful"}
      initialQuery={typeof q === "string" ? q.slice(0, 40) : ""}
    />
  );
}
