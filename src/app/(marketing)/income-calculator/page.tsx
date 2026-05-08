import type { Metadata } from "next";
import { Walkthrough } from "@/components/marketing-v3/Walkthrough";
import { Pricing } from "@/components/marketing-v3/Pricing";
import { FinalCTA } from "@/components/marketing-v3/FinalCTA";
import { Schema } from "@/components/Schema";
import {
  organizationSchema,
  webApplicationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "Airbnb income calculator (UK) — Stayful Intelligence";
const PAGE_DESCRIPTION =
  "Free Airbnb income calculator for any UK property. Type a postcode and get an 11-section report — top market potential, your filtered estimate, gross-to-net revenue, 12-month forecast, risk, and a ranked growth playbook.";
const PAGE_URL = siteUrl("/income-calculator");
const LAST_UPDATED = "2026-05-08";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

export default function IncomeCalculatorPage() {
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
      <Walkthrough />
      <Pricing />
      <FinalCTA />
    </>
  );
}
