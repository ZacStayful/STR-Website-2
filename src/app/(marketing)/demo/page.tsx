import type { Metadata } from "next";
import { VideoTour } from "@/components/marketing-v3/VideoTour";
import { ReportGallery } from "@/components/marketing-v3/ReportGallery";
import { FinalCTA } from "@/components/marketing-v3/FinalCTA";
import { Schema } from "@/components/Schema";
import {
  organizationSchema,
  webApplicationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "Sample report — see Stayful Intelligence in action";
const PAGE_DESCRIPTION =
  "Watch a 2-minute walkthrough of the Stayful Property Analyser running 17 Park Crescent, York end-to-end, then browse three real 2025 case studies from York, Leeds and Lincoln.";
const PAGE_URL = siteUrl("/demo");
const LAST_UPDATED = "2026-05-08";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

export default function DemoPage() {
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
      <VideoTour />
      <ReportGallery />
      <FinalCTA />
    </>
  );
}
