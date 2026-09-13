import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMarketSnapshot } from "@/lib/market/cached";
import { getMarketAccess, requireMarketAccess } from "@/lib/market/gate";
import { areaMetaForSlug } from "@/lib/market/areas";
import { siteUrl } from "@/lib/url";
import { MarketExplorerProductPage } from "../_components/product/MarketExplorerProductPage";
import { ExplorerShell } from "../_components/explorer/ExplorerShell";
import { loadExplorerUser } from "../_lib/loadExplorerUser";
import { isSortKey } from "@/lib/market/rank";

// Deep link into the explorer with one area's drawer open. Members-only and
// rendered per request; the metadata is static (no live figures) because it
// resolves even for signed-out visitors, who get the product page.
export async function generateMetadata({ params }: { params: Promise<{ area: string }> }): Promise<Metadata> {
  const { area: slug } = await params;
  const meta = areaMetaForSlug(slug);
  if (!meta) return { title: { absolute: "Market Explorer | Stayful" }, robots: { index: false, follow: false } };
  const path = `/markets/${meta.slug}`;
  const title = `${meta.name} Short-Term Rental Market Data | Stayful`;
  const description = `Short-term rental data for ${meta.name}: average revenue, occupancy, yield-on-cost, competition, licensing rules and short-vs-long-let. Available to Stayful members.`;
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: siteUrl(path) },
    openGraph: { title, description, url: siteUrl(path) },
  };
}

export default async function AreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ area: string }>;
  searchParams: Promise<{ sort?: string; district?: string }>;
}) {
  const { area: slug } = await params;
  const meta = areaMetaForSlug(slug);
  // A truly unknown slug (not a mapped city, not a valid postcode-area code)
  // 404s for everyone — slug validity reveals nothing about market data.
  if (!meta) notFound();
  // Members only: blocked users go to /upgrade and come back to this area;
  // signed-out visitors get the public product page.
  if ((await requireMarketAccess(`/markets/${meta.slug}`)) === "anon") return <MarketExplorerProductPage />;

  const access = await getMarketAccess();
  const [{ sort, district }, snapshot, user] = await Promise.all([searchParams, getMarketSnapshot(), loadExplorerUser(access.user)]);
  const { cards, regions, national } = snapshot;
  const hasData = cards.some((c) => c.code === meta.code);
  // ?district=NG7 opens a sub-market inside the area; anything that is not one of its districts is ignored.
  const initialDistrict = typeof district === "string" && /^[A-Z]{1,2}\d[A-Z\d]?$/i.test(district) ? district.toUpperCase() : null;

  return (
    <ExplorerShell
      cards={cards}
      regions={regions}
      national={national}
      goals={user.goals}
      savedAreas={user.savedAreas}
      userEmail={user.email}
      alertWeekly={user.alertWeekly}
      sourcingAlerts={user.sourcingAlerts}
      listings={user.listings}
      initialArea={meta.code}
      initialAreaName={hasData ? null : meta.name}
      initialDistrict={initialDistrict}
      initialSort={isSortKey(sort) ? sort : "stayful"}
    />
  );
}
