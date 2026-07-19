import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/url";
import { listAreaCodes } from "@/lib/market/explorer";
import { areaMetaForCode } from "@/lib/market/areas";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const routes = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/markets", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/income-calculator", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/short-term-vs-long-term-letting", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/features", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/about", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/demo", priority: 0.6, changeFrequency: "monthly" as const },
  ];

  const base: MetadataRoute.Sitemap = routes.map((r) => ({
    url: siteUrl(r.path),
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // Per-area pages that currently have data.
  let areaCodes: string[] = [];
  try {
    areaCodes = await listAreaCodes();
  } catch {
    areaCodes = [];
  }
  const areaRoutes: MetadataRoute.Sitemap = areaCodes.map((code) => ({
    url: siteUrl(`/markets/${areaMetaForCode(code).slug}`),
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [...base, ...areaRoutes];
}
