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
          "/estimate",
          "/dashboard",
          "/account",
          "/upgrade",
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
