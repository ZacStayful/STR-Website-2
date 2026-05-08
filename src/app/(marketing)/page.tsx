import type { Metadata } from "next";
import { Hero } from "@/components/marketing-v3/Hero";
import { StatsBar } from "@/components/marketing-v3/StatsBar";
import { VideoTour } from "@/components/marketing-v3/VideoTour";
import { Walkthrough } from "@/components/marketing-v3/Walkthrough";
import { ReportGallery } from "@/components/marketing-v3/ReportGallery";
import { ComparisonHero } from "@/components/marketing-v3/ComparisonHero";
import { Comparison } from "@/components/marketing-v3/Comparison";
import { Schema } from "@/components/Schema";
import {
  organizationSchema,
  webApplicationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "Stayful Intelligence — The decision engine for short-term rental";
const PAGE_DESCRIPTION =
  "A decision engine for short-term rental — not a revenue calculator. Type a UK postcode and get an 11-section report on what your property could earn, how the market actually behaves and what you'd need to do to win in it.";
const PAGE_URL = siteUrl("/");
const LAST_UPDATED = "2026-05-08";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
    siteName: "Stayful",
    locale: "en_GB",
    type: "website",
  },
};

export default function HomePage() {
  return (
    <>
      <Schema
        items={[
          organizationSchema(),
          webApplicationSchema({
            name: "Stayful Intelligence",
            url: PAGE_URL,
            description: PAGE_DESCRIPTION,
          }),
          webPageSchema({
            name: PAGE_TITLE,
            url: PAGE_URL,
            description: PAGE_DESCRIPTION,
            dateModified: LAST_UPDATED,
          }),
        ]}
      />

      <Hero />
      <StatsBar />
      <VideoTour />
      <Walkthrough />
      <ReportGallery />
      <ComparisonHero />
      <Comparison />
    </>
  );
}
