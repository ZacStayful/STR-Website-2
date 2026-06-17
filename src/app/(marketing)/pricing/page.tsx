import type { Metadata } from "next";
import { Pricing } from "@/components/marketing-v3/Pricing";
import { FAQ } from "@/components/marketing-v3/FAQ";
import { FinalCTA } from "@/components/marketing-v3/FinalCTA";
import { Schema } from "@/components/Schema";
import {
  faqSchema,
  organizationSchema,
  softwareApplicationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";
import { FAQS } from "@/lib/faqs-data";

const PAGE_TITLE = "Pricing — £39.99/month or £360/year";
const PAGE_DESCRIPTION =
  "Stayful Intelligence pricing. Run one report free with the 14-day trial, then £39.99/month for unlimited analyses or £360/year (save 25% paid annually). No contract, cancel any time.";
const PAGE_URL = siteUrl("/pricing");
const LAST_UPDATED = "2026-05-08";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

export default function PricingPage() {
  return (
    <>
      <Schema
        items={[
          organizationSchema(),
          softwareApplicationSchema({
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
          faqSchema(FAQS),
        ]}
      />
      <Pricing />
      <FAQ />
      <FinalCTA />
    </>
  );
}
