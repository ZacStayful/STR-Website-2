import type { Metadata } from "next";
import Link from "next/link";
import { getAreaCards } from "@/lib/market/cached";
import { getMarketAccess, requireMarketAccess } from "@/lib/market/gate";
import { MarketExplorerProductPage } from "./_components/product/MarketExplorerProductPage";
import { FilterableAreas } from "./_components/FilterableAreas";
import { siteUrl } from "@/lib/url";

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
    title: "Market Explorer — UK Short-Term Rental Yields by Area",
    description:
      "Browse UK areas by short-term rental investment potential. Compare average revenue, occupancy, yield-on-cost, licensing rules and short-vs-long-let.",
    robots: { index: false, follow: false },
    alternates: { canonical: siteUrl("/markets") },
  };
}

export default async function MarketsPage() {
  // Members only. Signed-out visitors get the public product page; blocked
  // users are redirected to /upgrade; nothing below runs for either.
  if ((await requireMarketAccess("/markets")) === "anon") return <MarketExplorerProductPage />;
  const cards = await getAreaCards();

  return (
    <>
      <header className="mx-hero">
        <div className="mx-container">
          <span className="mx-eyebrow">Stayful Market Explorer</span>
          <h1>Where should you invest in UK short-term lets?</h1>
          <p>
            Explore UK areas by real short-term-rental performance — average revenue,
            occupancy, yield-on-cost, the local licensing picture, and whether short-let
            actually beats a long-let. Included in every Stayful trial and subscription.
          </p>
        </div>
      </header>

      <div className="mx-container">
        <div className="mx-shell">
          <nav className="mx-subnav" aria-label="Market Explorer">
            <Link href="/markets" aria-current="page">All areas</Link>
            <Link href="/markets/map">Map view</Link>
            <Link href="/estimate">Analyse an address</Link>
            <Link href="/short-term-vs-long-term-letting">Short vs long-let</Link>
          </nav>

          <main>
            {cards.length === 0 ? (
              <div className="mx-empty">
                <h2>Market data is loading</h2>
                <p>
                  We couldn’t load area data right now. This usually clears on its own —
                  please try again shortly.
                </p>
              </div>
            ) : (
              <FilterableAreas cards={cards} />
            )}

            <p className="mx-disclaimer">
              Figures are averages aggregated from Stayful analyser reports across each
              postcode area and are indicative, not a guarantee of returns. Yield-on-cost
              uses an area property-value estimate as a purchase-price proxy. Licensing
              flags are a general guide — always confirm with the local authority before
              buying. Click any area to see the detail and analyse a specific address.
            </p>
          </main>
        </div>
      </div>
    </>
  );
}
