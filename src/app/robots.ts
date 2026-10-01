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
          "/welcome",
          "/today",
          "/my-deals",
          // The text-message short link only ("/m" alone would also block /markets).
          "/m$",
          "/estimate",
          "/reports",
          "/deal/",
          "/d/",
          "/deals",
          "/extension/connect",
          "/dashboard",
          "/account",
          "/upgrade",
          "/markets/",
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
