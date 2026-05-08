import type { Metadata } from "next";
import { Walkthrough } from "@/components/marketing-v3/Walkthrough";
import { Schema } from "@/components/Schema";
import {
  organizationSchema,
  softwareApplicationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "Features — the 11 sections of every Stayful report";
const PAGE_DESCRIPTION =
  "Every Stayful Property Analyser run produces the same 11-section report: intake, live data ingest, decision overview, comparables, amenities, gross-to-net revenue, 12-month forecast, local area, setup costs, risk assessment, growth playbook.";
const PAGE_URL = siteUrl("/features");
const LAST_UPDATED = "2026-05-08";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

export default function FeaturesPage() {
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
        ]}
      />
      <Walkthrough />
    </>
  );
}
