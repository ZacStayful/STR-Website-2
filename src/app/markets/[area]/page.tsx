import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMarketSnapshot } from "@/lib/market/cached";
import { getMarketAccess, requireMarketAccess } from "@/lib/market/gate";
import { areaMetaForSlug } from "@/lib/market/areas";
import { siteUrl } from "@/lib/url";
import { MarketExplorerProductPage } from "../_components/product/MarketExplorerProductPage";
import { MarketPage } from "../_components/explorer/v2/market/MarketPage";
import { loadExplorerUser } from "../_lib/loadExplorerUser";
import { isSortKey } from "@/lib/market/rank";
import { isTabKey } from "@/lib/market/tab-model";
import { marketDealsForArea } from "@/lib/marketplace/queries";
import { dealVisibilityFor } from "@/lib/marketplace/tier";
import { isAdminEmail } from "@/lib/admin";

// One market as a full page: overview, sub-markets, listings, occupancy,
// revenue, rates, seasonality, competition, licensing, long-let vs
// short-let and the member's deals. Members-only and rendered per request;
// the metadata is static (no live figures) because it resolves even for
// signed-out visitors, who get the product page.
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
  searchParams: Promise<{ sort?: string; district?: string; tab?: string }>;
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
  const visibility = await dealVisibilityFor(access.user?.id ?? null, isAdminEmail(access.user?.email));
  const [{ sort, district, tab }, snapshot, user, marketDeals] = await Promise.all([searchParams, getMarketSnapshot(), loadExplorerUser(access.user), marketDealsForArea(meta.code, visibility)]);
  const { cards } = snapshot;
  const card = cards.find((c) => c.code === meta.code) ?? null;
  // ?district=NG7 opens a sub-market inside the area; anything that is not one of its districts is ignored by the page.
  const initialDistrict = typeof district === "string" && /^[A-Z]{1,2}\d[A-Z\d]?$/i.test(district) ? district.toUpperCase() : null;

  return (
    <MarketPage
      card={card}
      areaName={meta.name}
      cards={cards}
      goals={user.goals}
      savedAreas={user.savedAreas}
      userEmail={user.email}
      alertWeekly={user.alertWeekly}
      sourcingAlerts={user.sourcingAlerts}
      listings={user.listings}
      marketDeals={marketDeals}
      initialTab={isTabKey(tab) ? tab : "overview"}
      initialDistrict={initialDistrict}
      initialSort={isSortKey(sort) ? sort : "stayful"}
    />
  );
}
