import type { Metadata } from "next";
import { TeamStrip } from "@/components/marketing-v3/TeamStrip";
import { FinalCTA } from "@/components/marketing-v3/FinalCTA";
import { Schema } from "@/components/Schema";
import {
  organizationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "About — built by UK short-let operators, not analysts";
const PAGE_DESCRIPTION =
  "Stayful is built by people who actually run short-lets. We've operated UK portfolios across York, Bath, Edinburgh and Manchester — and built the Property Analyser because the tool we needed didn't exist.";
const PAGE_URL = siteUrl("/about");
const LAST_UPDATED = "2026-05-08";

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
        ]}
      />
      <TeamStrip />
      <FinalCTA />
    </>
  );
}
