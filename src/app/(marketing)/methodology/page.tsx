import type { Metadata } from "next";
import { ProvenanceBar } from "@/components/marketing-v3/ProvenanceBar";
import { SourceLedger } from "@/components/marketing-v3/SourceLedger";
import { MethodNotes } from "@/components/marketing-v3/MethodNotes";
import { AccuracyLedger } from "@/components/marketing-v3/AccuracyLedger";
import { ReportGallery } from "@/components/marketing-v3/ReportGallery";
import { WhyWeBuilt } from "@/components/marketing-v3/WhyWeBuilt";
import { Founders } from "@/components/marketing-v3/Founders";
import { FAQ } from "@/components/marketing-v3/FAQ";
import { FinalCTA } from "@/components/marketing-v3/FinalCTA";
import { Schema } from "@/components/Schema";
import {
  breadcrumbSchema,
  datasetSchema,
  faqSchema,
  organizationSchema,
  personSchema,
  webPageSchema,
} from "@/lib/schema";
import { TRUST_FAQS } from "@/lib/faqs-data";
import { ACCURACY_WINDOW } from "@/lib/case-studies-data";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE =
  "How accurate is Stayful Intelligence? Our data sources and forecast record";
const PAGE_DESCRIPTION =
  "Where every number in a Stayful report comes from, how the figure is built, and how our income forecasts have compared to what six managed UK short-lets actually earned — including where the model was wrong.";
const PAGE_URL = siteUrl("/methodology");
const LAST_UPDATED = "2026-09-15";

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

export default function MethodologyPage() {
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
          breadcrumbSchema([
            { name: "Home", url: siteUrl("/") },
            { name: "Methodology", url: PAGE_URL },
          ]),
          datasetSchema({
            url: PAGE_URL,
            temporalCoverage: "2025-01/2025-12",
          }),
          faqSchema(TRUST_FAQS),
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

      <section className="why-built section-tight">
        <div className="wrap-narrow">
          <div className="eyebrow">Provenance</div>
          <h1>Show your working.</h1>
          <p className="lede">
            Most short-term rental intelligence is modelled from comparables:
            listings observed from the outside, by a company that has never
            taken a booking. That is a reasonable way to estimate a market and
            an unreliable way to underwrite a purchase, and it is why buyers
            treat these figures as indicative rather than dependable.
          </p>
          <p className="lede">
            Stayful is a management company. We forecast a property&rsquo;s
            income, then — for the ones we take on — operate it and find out
            what it really earned. This page is the whole of that: every
            source we use, how the number is assembled, and the record of
            where our forecasts landed against {ACCURACY_WINDOW} reality.
          </p>
        </div>
      </section>

      <ProvenanceBar />
      <SourceLedger />
      <MethodNotes />
      <AccuracyLedger variant="full" />
      <ReportGallery />
      <WhyWeBuilt />
      <Founders />
      <FAQ
        items={TRUST_FAQS}
        eyebrow="The awkward questions"
        heading="Answers, not pitches."
      />
      <FinalCTA />
    </>
  );
}
