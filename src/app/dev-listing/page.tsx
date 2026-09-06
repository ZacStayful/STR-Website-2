// TEMPORARY fixture route for screenshots — removed before the PR.
import EstimatePage from "@/app/estimate/page";
import { DEMO_MAP } from "@/lib/demo-data";
import { SourceListingCard } from "@/app/estimate/_components/SourceListingCard";
import { purchaseDeal, rentToRentDeal, monthlyCashflow } from "@/lib/listing/deal";
import type { AnalysisResult } from "@/lib/types";
import type { TrackedListing } from "@/lib/listing/competitors";
import { summariseCompetitors } from "@/lib/listing/competitors";
import type { ListingSnapshot } from "@/lib/listing/types";
import type { QuickEstimate } from "@/lib/listing/quick-types";

export const dynamic = "force-dynamic";

function tracked(id: string, name: string, rev: number, dLat: number, dLng: number, beds = 2): TrackedListing {
  return { listingId: id, name, url: `https://www.airbnb.co.uk/rooms/${id}`, lat: 53.4794 + dLat, lng: -2.2453 + dLng, bedrooms: beds, bathrooms: 1, guests: beds * 2, roomType: "Entire home/apt", propertyType: "Apartment", annualRevenue: rev, adr: Math.round(rev / 200), occupancy: 0.55 + (rev % 30) / 100, reviewCount: 20 + (rev % 90), rating: 4.6 + (rev % 40) / 100, activeDays: 320, distanceKm: Math.round(Math.hypot(dLat * 111, dLng * 65) * 100) / 100 };
}

export default async function DevListing({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const base = DEMO_MAP.manchester as AnalysisResult;
  const comps = [tracked("1", "Bright city loft", 41000, 0.002, 0.003), tracked("2", "Quays apartment", 28000, -0.004, 0.001), tracked("3", "Northern Quarter pad", 36000, 0.001, -0.005, 3), tracked("4", "Canal-side flat", 0, -0.002, -0.002), tracked("5", "Deansgate two-bed", 52000, 0.005, -0.001), tracked("1115704756752582530", "Cosy House for 8", 44000, 0.003, 0.004, 4)];
  const dealBase = { grossRevenue: base.shortLet.annualRevenue, adr: base.shortLet.averageDailyRate, bedrooms: base.property.bedrooms };
  const deal = view === "r2r" ? { ...rentToRentDeal(1350, dealBase), basis: "advertised-rent" as const } : { ...purchaseDeal(220000, dealBase), basis: "asking-price" as const };
  const fixed = deal.kind === "rent-to-rent" ? deal.advertisedRentPcm : deal.mortgageMonthly;
  const result: AnalysisResult = {
    ...base,
    sourceListing: { url: "https://www.rightmove.co.uk/properties/91877934", source: "rightmove", kind: view === "r2r" ? "rent" : "sale", title: "2 bedroom apartment for sale in Labrador Quay", price: { amount: view === "r2r" ? 1350 : 220000, period: view === "r2r" ? "pcm" : "total" } },
    deal,
    cashflow: monthlyCashflow(base.shortLet.monthlyRevenue, fixed),
    competitors: { summary: summariseCompetitors(comps, 2), top: comps, tracked: comps[5], trackedMissing: false, provider: "airbtics", updatedAt: new Date().toISOString() },
    secondOpinion: { annualRevenue: Math.round(base.shortLet.annualRevenue * 1.08), adr: Math.round(base.shortLet.averageDailyRate * 1.05), occupancy: 61, confidence: "medium", rangeLow: Math.round(base.shortLet.annualRevenue * 0.92), rangeHigh: Math.round(base.shortLet.annualRevenue * 1.24), monthly: [], comparables: [], provider: "pmi", updatedAt: new Date().toISOString() },
    reportId: "00000000-0000-0000-0000-000000000000",
  };
  if (view === "card") {
    const snapshot: ListingSnapshot = { source: "airbnb", id: "1115704756752582530", canonicalUrl: "https://www.airbnb.co.uk/rooms/1115704756752582530", fetchedAt: new Date().toISOString(), parserVersion: 1, kind: "str", title: "*Cosy House for 8 >Manchester & Etihad > parking *", displayAddress: "Greater Manchester", postcode: "M34 3AA", outcode: "M34", lat: 53.4539, lng: -2.15971, bedrooms: 4, bathrooms: 2, guests: 8, rawType: "Entire home/apt", features: [], photos: ["https://a0.muscache.com/im/pictures/miso/Hosting-1115704756752582530/original/96fca4c8-3480-402b-8cc7-ed2909df1f41.jpeg?im_w=720"], str: { rating: 4.91, reviewCount: 74, isSuperhost: true }, locationConfidence: "reverse-geocoded" };
    const quick: QuickEstimate = { area: { code: "M", slug: "manchester", name: "Manchester", score: 71, grade: "B", gradeLabel: "Strong", confidence: { tier: "confirmed", label: "Confirmed" }, competition: { label: "Busy", percentile: 68 }, directBooking: { score: 64, label: "Strong" }, licensing: { status: "confirmed-unrestricted", headline: "No licence required today; national register incoming" }, managedByStayful: true, trend: { direction: "up", label: "Rising enquiries" }, bedroomStat: { bedrooms: 4, samples: 6, grossRevenue: 46800, adr: 190, occupancy: 62 }, headline: { grossRevenue: 31000, adr: 140, occupancy: 60, totalSamples: 48 } }, estimate: { grossRevenue: 46800, adr: 190, occupancy: 62, source: "area-bedrooms", note: "Manchester average for 4-bed properties (6 reports)", updatedAt: null, stale: false }, competitors: { summary: summariseCompetitors(comps, 4), top: comps, cell: "live", updatedAt: new Date().toISOString(), stale: false }, tracked: { ...comps[5], provider: "airbtics", updatedAt: new Date().toISOString() }, trackedMissing: false, pmiMarket: null, deal: null, limited: false };
    return (
      <div className="mx-auto max-w-2xl p-6">
        <SourceListingCard snapshot={snapshot} quick={quick} warnings={["Location is approximate (the site only shows a rough pin), so the postcode may be a neighbouring one."]} />
      </div>
    );
  }
  if (view === "form") return <EstimatePage />;
  return <EstimatePage initialResult={result} />;
}
