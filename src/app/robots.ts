import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin",
          "/estimate",
          "/reports",
          "/deal/",
          "/dashboard",
          "/account",
          "/upgrade",
          "/markets/",
          "/report/",
          "/auth/",
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
  };
}
