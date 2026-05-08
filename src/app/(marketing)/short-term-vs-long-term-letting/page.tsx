import type { Metadata } from "next";
import { ComparisonHero } from "@/components/marketing-v3/ComparisonHero";
import { Comparison } from "@/components/marketing-v3/Comparison";
import { Schema } from "@/components/Schema";
import {
  organizationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "Short-let vs long-let — which earns more for your UK property";
const PAGE_DESCRIPTION =
  "The same UK property can earn radically more as a short-let than as a long-let — but only if the demand drivers, regulation and operating costs add up. Stayful tells you whether they do, before you commit.";
const PAGE_URL = siteUrl("/short-term-vs-long-term-letting");
const LAST_UPDATED = "2026-05-08";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

export default function ShortVsLongPage() {
  return (
    <>
      <Schema
        items={[
          organizationSchema(),
          webPageSchema({
            name: PAGE_TITLE,
            url: PAGE_URL,
            description: PAGE_DESCRIPTION,
            dateModified: LAST_UPDATED,
          }),
        ]}
      />
      <ComparisonHero />
      <Comparison />
    </>
  );
}
