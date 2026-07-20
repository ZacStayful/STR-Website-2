import type { Metadata } from "next";
import Link from "next/link";
import { getAreaCards } from "@/lib/market/explorer";
import { UKMap, type MapArea } from "../_components/UKMap";
import { siteUrl } from "@/lib/url";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "UK Short-Term Rental Map — Explore Areas by Data",
  description:
    "An interactive map of the UK short-term rental market. Every postcode area is shaded by data accuracy; click a region for its average revenue, occupancy and full report.",
  alternates: { canonical: siteUrl("/markets/map") },
};

export default async function MarketsMapPage() {
  const cards = await getAreaCards();

  const areas: MapArea[] = cards.map((c) => ({
    code: c.code,
    slug: c.slug,
    name: c.name,
    tier: c.confidence.tier,
    tierLabel: c.confidence.label,
    samples: c.headline.totalSamples,
    grossRevenue: c.headline.grossRevenue,
    adr: c.headline.adr,
    occupancy: c.headline.occupancy,
    score: c.score?.score ?? null,
  }));

  return (
    <>
      <header className="mx-hero">
        <div className="mx-container">
          <span className="mx-eyebrow">Stayful Market Explorer</span>
          <h1>The UK short-term rental map</h1>
          <p>
            Every postcode area, shaded by how much real data we hold — deep green where
            it’s most accurate, pale where it’s still early, grey where we have none yet.
            Zoom in, click a region, and see its market rates and full report.
          </p>
        </div>
      </header>

      <div className="mx-container">
        <div className="mx-shell">
          <nav className="mx-subnav" aria-label="Market Explorer">
            <Link href="/markets">All areas (list)</Link>
            <Link href="/markets/map" aria-current="page">Map view</Link>
            <Link href="/estimate">Analyse an address</Link>
            <Link href="/pricing">Pricing</Link>
          </nav>

          <main>
            {areas.length === 0 ? (
              <div className="mx-empty">
                <h2>Map data is loading</h2>
                <p>We couldn’t load area data right now — please try again shortly.</p>
              </div>
            ) : (
              <UKMap areas={areas} />
            )}
            <p className="mx-disclaimer">
              Regions are UK postcode areas. Shading reflects how many analyser reports back
              each area (Confirmed / Building / Early), not investment quality. Northern
              Ireland (BT) boundaries aren’t included in this map yet. Figures are indicative
              averages — click through for the full breakdown.
            </p>
          </main>
        </div>
      </div>
    </>
  );
}
