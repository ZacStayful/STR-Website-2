import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/url";
import { areaMetaForCode } from "@/lib/market/areas";
import { liveCountsByArea } from "@/lib/marketplace/queries";
import { publicDealVisibility } from "@/lib/marketplace/tier";

export const revalidate = 3600;

// The Market Explorer's per-area pages are members-only, so only the public
// /markets product page is listed. The deals marketplace's per-area teasers
// are public and listed for every area with a live deal.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const deals = await publicDealVisibility().then((v) => liveCountsByArea(v.hourCutoffIso)).catch(() => []);
  const routes = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/markets", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/income-calculator", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/short-term-vs-long-term-letting", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/features", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/methodology", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/demo", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/extension", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/extension/privacy", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/short-let-deals", priority: 0.8, changeFrequency: "daily" as const },
    ...deals.filter((d) => d.total > 0).map((d) => ({ path: `/short-let-deals/${areaMetaForCode(d.code).slug}`, priority: 0.7, changeFrequency: "daily" as const })),
  ];

  return routes.map((r) => ({
    url: siteUrl(r.path),
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
