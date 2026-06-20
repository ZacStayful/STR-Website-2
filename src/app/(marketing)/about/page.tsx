import type { Metadata } from "next";
import { TeamStrip } from "@/components/marketing-v3/TeamStrip";
import { WhyWeBuilt } from "@/components/marketing-v3/WhyWeBuilt";
import { Founders } from "@/components/marketing-v3/Founders";
import { FinalCTA } from "@/components/marketing-v3/FinalCTA";
import { Schema } from "@/components/Schema";
import {
  organizationSchema,
  personSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "About — built by UK short-let operators, not analysts";
const PAGE_DESCRIPTION =
  "Stayful is a UK Airbnb management company. Built by founders Zac Harrison and Martyn Butler — operators who run short-let portfolios across York, Bath, Edinburgh and Manchester.";
const PAGE_URL = siteUrl("/about");
const LAST_UPDATED = "2026-05-09";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

export default function AboutPage() {
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
          personSchema({
            name: "Zac Harrison",
            jobTitle: "Co-founder",
            image: siteUrl("/assets/founder-zac.png"),
          }),
          personSchema({
            name: "Martyn Butler",
            jobTitle: "Co-founder",
            image: siteUrl("/assets/founder-martyn.png"),
          }),
        ]}
      />
      <TeamStrip />
      <WhyWeBuilt />
      <Founders />
      <FinalCTA />
    </>
  );
}
