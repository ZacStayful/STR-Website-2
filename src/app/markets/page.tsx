import type { Metadata } from "next";
import { getAreaCards } from "@/lib/market/explorer";
import { FilterableAreas } from "./_components/FilterableAreas";
import { siteUrl } from "@/lib/url";

// ISR: the underlying data is a slowly growing snapshot.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Market Explorer — UK Short-Term Rental Yields by Area",
  description:
    "Browse UK areas by short-term rental investment potential. Compare average revenue, occupancy, yield-on-cost, licensing rules and short-vs-long-let — free, no login.",
  alternates: { canonical: siteUrl("/markets") },
};

export default async function MarketsPage() {
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
            actually beats a long-let. Every figure is open. No login, no paywall.
          </p>
        </div>
      </header>

      <div className="mx-container">
        <div className="mx-shell">
          <nav className="mx-subnav" aria-label="Market Explorer">
            <a href="/markets" aria-current="page">All areas</a>
            <a href="/estimate">Analyse an address</a>
            <a href="/short-term-vs-long-term-letting">Short vs long-let</a>
            <a href="/pricing">Pricing</a>
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
