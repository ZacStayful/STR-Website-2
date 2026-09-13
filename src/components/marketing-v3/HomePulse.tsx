import Link from "next/link";
import { getNationalSeries } from "@/lib/market/cached";
import { MarketPulse } from "@/app/markets/_components/explorer/MarketPulse";
import "@/app/markets/markets.css";

/** Nationwide market pulse on the homepage (real, national-only figures), linking to the explorer. */
export async function HomePulse() {
  const national = await getNationalSeries().catch(() => []);
  if (national.length === 0) return null;
  return (
    <section className="home-pulse">
      <div className="wrap">
        <div className="mx mxp-sample">
          <MarketPulse national={national} compact />
        </div>
        <Link href="/markets" className="home-pulse-link">See it area by area in the Market Explorer →</Link>
      </div>
    </section>
  );
}
