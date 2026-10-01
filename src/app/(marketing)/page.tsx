import type { Metadata } from "next";
import { Hero } from "@/components/marketing-v3/Hero";
import { ProvenanceBar } from "@/components/marketing-v3/ProvenanceBar";
import { ProvenanceStrip } from "@/components/marketing-v3/ProvenanceStrip";
import { AccuracyLedger } from "@/components/marketing-v3/AccuracyLedger";
import { WhyWeBuilt } from "@/components/marketing-v3/WhyWeBuilt";
import { HomePulse } from "@/components/marketing-v3/HomePulse";
import { VideoTour } from "@/components/marketing-v3/VideoTour";
import { Walkthrough } from "@/components/marketing-v3/Walkthrough";
import { ReportGallery } from "@/components/marketing-v3/ReportGallery";
import { Comparison } from "@/components/marketing-v3/Comparison";
import { Pricing } from "@/components/marketing-v3/Pricing";
import { FAQ } from "@/components/marketing-v3/FAQ";
import { FinalCTA } from "@/components/marketing-v3/FinalCTA";
import { Schema } from "@/components/Schema";
import {
  faqSchema,
  organizationSchema,
  webApplicationSchema,
  webPageSchema,
} from "@/lib/schema";
import { faqsWith } from "@/lib/faqs-data";
import { costFiguresNow } from "@/lib/faqs-server";
import { publicOfferNow } from "@/lib/starter-pack/public";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE =
  "Stayful Intelligence — short-term rental data from a real management company";
const PAGE_DESCRIPTION =
  "Short-term rental intelligence from a company that actually manages the properties. See the income forecasts we produced before six UK short-lets went live, next to what they really earned. Type a UK postcode for a 10-section report.";
const PAGE_URL = siteUrl("/");
const LAST_UPDATED = "2026-05-08";

// Batch 20: the pricing section and the FAQ follow billing_settings (the
// starter pack's cutover among them), refreshed every five minutes like /pricing.
export const revalidate = 300;

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

export default async function HomePage() {
  const faqs = faqsWith(await publicOfferNow(), await costFiguresNow());
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
          faqSchema(faqs),
        ]}
      />

      <Hero>
        <ProvenanceStrip />
      </Hero>
      <ProvenanceBar />
      <AccuracyLedger />
      <HomePulse />
      <VideoTour />
      <Walkthrough />
      <ReportGallery />
      <WhyWeBuilt variant="landing" />
      <Comparison />
      <Pricing />
      <FAQ items={faqs} />
      <FinalCTA />
    </>
  );
}
