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
import { faqsWith } from "@/lib/faqs-data";
import { publicOfferNow } from "@/lib/starter-pack/public";

const PAGE_URL = siteUrl("/pricing");
const LAST_UPDATED = "2026-09-27";

// The plan grid reads its prices and the new pricing date from billing_settings:
// refreshed every five minutes, so a change on /admin/billing (or the date
// itself arriving) shows without a redeploy.
export const revalidate = 300;

// Batch 20: the title and description say what a new member gets today (the £20 until the starter pack's cutover).
export async function generateMetadata(): Promise<Metadata> {
  const offer = await publicOfferNow();
  return { title: offer.pricingTitle, description: offer.pricingDescription, alternates: { canonical: PAGE_URL } };
}

export default async function PricingPage() {
  const offer = await publicOfferNow();
  const PAGE_TITLE = offer.pricingTitle;
  const PAGE_DESCRIPTION = offer.pricingDescription;
  const faqs = faqsWith(offer);
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
          faqSchema(faqs),
        ]}
      />
      <Pricing />
      <FAQ items={faqs} />
      <FinalCTA />
    </>
  );
}
