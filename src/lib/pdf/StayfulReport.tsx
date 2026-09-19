import React from "react";
import { Document } from "@react-pdf/renderer";
import { Page1Overview } from "./pages/Page1Overview";
import { Page2Revenue } from "./pages/Page2Revenue";
import { Page3Comparables } from "./pages/Page3Comparables";
import { Page4LocalRisk } from "./pages/Page4LocalRisk";
import { Page6SetupCosts } from "./pages/Page6SetupCosts";
import { Page7Deal } from "./pages/Page7Deal";
import type { PdfReportData } from "./derive";
import { pdfBrand } from "./theme";

export function StayfulReport({ data }: { data: PdfReportData }) {
  // Document metadata is visible in every PDF reader's properties panel, so
  // it carries the brand too — a file that renders as the customer's but
  // reports "Author: Stayful" gives the game away.
  const brand = pdfBrand(data.brand);
  return (
    <Document
      title={`${brand.companyName} Property Analysis — ${data.property.address}`}
      author={brand.companyName}
      subject="Property Income Analysis"
    >
      <Page1Overview data={data} />
      <Page2Revenue data={data} />
      <Page3Comparables data={data} />
      <Page4LocalRisk data={data} />
      {data.setup && <Page6SetupCosts data={data.setup} brand={data.brand} />}
      {data.deal && <Page7Deal deal={data.deal} brand={data.brand} />}
    </Document>
  );
}
