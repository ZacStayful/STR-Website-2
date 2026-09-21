import type { NextConfig } from "next";

/**
 * The PDF report reads its typefaces and wordmark from disk at render time.
 * Nothing else in this app touches the filesystem at runtime, so without these
 * entries the files are absent from the serverless bundle: the report renders
 * correctly under `next dev` and silently drops to Helvetica in production.
 *
 * Every route that renders a PDF must be listed. `/api/internal/crm-deliveries`
 * is easy to miss — the cron drains the queue and attaches the report to a
 * customer's CRM from there.
 */
const PDF_ASSETS = [
  "src/lib/pdf/fonts/**/*",
  "public/assets/stayful-logo.png",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/generate-pdf": PDF_ASSETS,
    "/r/[token]/pdf": PDF_ASSETS,
    "/api/v1/reports/[id]/pdf": PDF_ASSETS,
    "/api/analyse": PDF_ASSETS,
    "/api/internal/crm-deliveries": PDF_ASSETS,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 2400],
    imageSizes: [64, 96, 128, 200, 256, 384, 512],
  },
  async redirects() {
    return [
      {
        source: "/about",
        destination: "/methodology",
        permanent: true,
      },
      {
        source: "/home",
        destination: "/",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
