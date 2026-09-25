/**
 * Entry point for scripts/render-sample-pdf.mjs. Kept as a .tsx outside src/
 * so it never ships, but inside the tsconfig so it typechecks with everything
 * else.
 */
import { join } from "node:path";
import { renderToFile } from "@react-pdf/renderer";
import React from "react";
import { StayfulReport } from "../src/lib/pdf/StayfulReport";
import { deriveReportData, buildSetupSnapshot } from "../src/lib/pdf/derive";
import { pdfBrand } from "../src/lib/pdf/theme";
import { sampleAnalysis, sampleSetup } from "../src/lib/pdf/__fixtures__/sample";
import type { PdfReportData } from "../src/lib/pdf/derive";

export interface VariantResult {
  name: string;
  file: string;
  expectedSheets: number | null;
  error?: string;
}

type Build = () => PdfReportData;

const VARIANTS: Array<{ name: string; sheets: number; build: Build }> = [
  {
    // The reference layout: six sections, setup costs included.
    name: "full",
    sheets: 6,
    build: () => {
      const d = deriveReportData(sampleAnalysis());
      d.preparedFor = "lead@email.com";
      d.setup = buildSetupSnapshot(sampleSetup()) ?? undefined;
      return d;
    },
  },
  {
    name: "no-setup",
    sheets: 5,
    build: () => {
      const d = deriveReportData(sampleAnalysis());
      return d;
    },
  },
  {
    name: "with-deal",
    sheets: 7,
    build: () => {
      const r = sampleAnalysis();
      const d = deriveReportData(r);
      d.setup = buildSetupSnapshot(sampleSetup()) ?? undefined;
      d.deal = {
        kind: "purchase",
        basisLabel: "Based on the asking price of £130,000",
        sourceUrl: "https://www.rightmove.co.uk/properties/123456",
        metrics: [
          { label: "Gross yield", value: "26.3%", sub: "on £130,000" },
          { label: "Net yield", value: "13.7%", sub: "after running costs" },
          { label: "Monthly cashflow", value: "£886", sub: "after £598 mortgage" },
          { label: "Deposit", value: "£32,500", sub: "25% of the asking price" },
          { label: "Stamp duty", value: "£6,500", sub: "additional-property rates" },
          { label: "Setup", value: "£3,110", sub: "fully furnished" },
          { label: "Cash in", value: "£42,110", sub: "deposit, duty and setup" },
          { label: "Return on cash", value: "25.2%", sub: "first-year, before tax" },
        ],
        cashflow: Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          revenue: [2686, 2532, 2546, 2087, 2760, 3061, 3446, 2969, 3288, 2765, 2455, 3236][i],
          operating: 1290,
          fixed: 848,
          net: [548, 394, 408, -51, 622, 923, 1308, 831, 1150, 627, 317, 1098][i],
        })),
        note: "Indicative only. Figures assume the finance defaults shown and exclude tax.",
      };
      return d;
    },
  },
  {
    // A customer's own branding: no Stayful name, no Stayful booking link.
    name: "white-label",
    sheets: 6,
    build: () => {
      const d = deriveReportData(sampleAnalysis());
      d.brand = pdfBrand({ companyName: "Northern Lets", contactLine: "Northern Lets · hello@northernlets.co.uk" });
      d.preparedFor = "prospect@example.com";
      d.setup = buildSetupSnapshot(sampleSetup()) ?? undefined;
      return d;
    },
  },
  {
    // A long line-item list: the setup table is the one page allowed to wrap.
    name: "long-setup",
    sheets: 7,
    build: () => {
      const d = deriveReportData(sampleAnalysis());
      d.setup = buildSetupSnapshot(sampleSetup("many")) ?? undefined;
      return d;
    },
  },
  {
    // A long address and a self-managed owner: the headline has to step down
    // rather than wrap into the hero, and the management row disappears.
    name: "long-address",
    sheets: 6,
    build: () => {
      const d = deriveReportData(
        sampleAnalysis({
          address: "Flat 4, Wellington House, 118-122 Gloucester Terrace, Kensington and Chelsea, London",
          locality: "London",
        }),
        { platformPct: 15, mgmtPct: 0, cleaningMonthly: null, selfManaged: true },
      );
      d.preparedFor = "a-rather-long-email-address@somelongdomainname.co.uk";
      d.setup = buildSetupSnapshot(sampleSetup()) ?? undefined;
      return d;
    },
  },
  {
    // A report saved before the comparable-history fields existed: the range
    // is derived from its comps; trend, stays and nearby count are absent.
    name: "legacy",
    sheets: 6,
    build: () => {
      const d = deriveReportData(sampleAnalysis({ legacy: true }));
      d.setup = buildSetupSnapshot(sampleSetup()) ?? undefined;
      return d;
    },
  },
  {
    // Everything that can be missing, missing at once.
    name: "degraded",
    sheets: 5,
    build: () => {
      const d = deriveReportData(
        sampleAnalysis({
          noValuation: true,
          noDemandDrivers: true,
          noAmenityData: true,
          noBookings: true,
          legacy: true,
          locality: null,
          address: "Rose Cottage",
          comparables: [sampleAnalysis().shortLet.comparables[0]],
        }),
      );
      return d;
    },
  },
];

export async function renderVariants(outDir: string, only?: string): Promise<VariantResult[]> {
  const chosen = only ? VARIANTS.filter((v) => v.name === only) : VARIANTS;
  const out: VariantResult[] = [];
  for (const v of chosen) {
    const file = join(outDir, `${v.name}.pdf`);
    try {
      const data = v.build();
      await renderToFile(<StayfulReport data={data} />, file);
      out.push({ name: v.name, file, expectedSheets: v.sheets });
    } catch (err) {
      out.push({
        name: v.name,
        file,
        expectedSheets: v.sheets,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
