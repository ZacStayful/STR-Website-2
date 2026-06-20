import React from "react";
import { Document } from "@react-pdf/renderer";
import { Page1Overview } from "./pages/Page1Overview";
import { Page2Revenue } from "./pages/Page2Revenue";
import { Page3Comparables } from "./pages/Page3Comparables";
import { Page4LocalRisk } from "./pages/Page4LocalRisk";
import { Page5Growth } from "./pages/Page5Growth";
import { Page6SetupCosts } from "./pages/Page6SetupCosts";
import type { PdfReportData } from "./derive";

export function StayfulReport({ data }: { data: PdfReportData }) {
  return (
    <Document
      title={`Stayful Property Analysis — ${data.property.address}`}
      author="Stayful"
      subject="Property Income Analysis"
    >
      <Page1Overview data={data} />
      <Page2Revenue data={data} />
      <Page3Comparables data={data} />
      <Page4LocalRisk data={data} />
      <Page5Growth data={data} />
      {data.setup && <Page6SetupCosts data={data.setup} />}
    </Document>
  );
}
