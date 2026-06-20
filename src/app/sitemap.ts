import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/url";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/income-calculator", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/short-term-vs-long-term-letting", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/features", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/about", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/demo", priority: 0.6, changeFrequency: "monthly" as const },
  ];
  return routes.map((r) => ({
    url: siteUrl(r.path),
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
