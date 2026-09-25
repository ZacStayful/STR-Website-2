import React from "react";
import { Document } from "@react-pdf/renderer";
import { Page1Verdict } from "./report/Page1Verdict";
import { Page2Numbers } from "./report/Page2Numbers";
import { Page3Market } from "./report/Page3Market";
import { Page4Location } from "./report/Page4Location";
import { Page5Setup } from "./report/Page5Setup";
import { Page6Plan } from "./report/Page6Plan";
import { PageDeal } from "./report/PageDeal";
import { PageDiligence } from "./report/PageDiligence";
import type { ReportChrome } from "./design/Chrome";
import { contentsFor, navFor, sectionsFor } from "./sections";
import type { PdfReportData } from "./derive";
import { pdfBrand } from "./theme";
import { stayfulLogo } from "./design/assets";

export function StayfulReport({ data }: { data: PdfReportData }) {
  // Document metadata shows in every reader's properties panel, so it carries
  // the brand too — a file that renders as the customer's but reports
  // "Author: Stayful" gives the game away.
  //
  // No brand at all means this is our own members' report, and only then does
  // it get the bundled wordmark. A customer's report falls back to their
  // company name in type rather than borrowing our logo.
  const ours = !data.brand;
  const resolved = pdfBrand(data.brand);
  const brand = ours && !resolved.logoDataUri
    ? { ...resolved, logoDataUri: stayfulLogo() ?? undefined }
    : resolved;

  const sections = sectionsFor({
    setup: Boolean(data.setup),
    deal: Boolean(data.deal),
    diligence: Boolean(data.diligence),
  });
  const nav = (id: Parameters<typeof navFor>[1]) => navFor(sections, id);

  const chrome: ReportChrome = {
    brand,
    addressLine: data.property.addressLine,
    locality: data.property.locality,
    issued: data.issuedAt,
    ...(data.preparedFor ? { preparedFor: data.preparedFor } : {}),
  };

  return (
    <Document
      title={`${brand.companyName} Property Analysis — ${data.property.address}`}
      author={brand.companyName}
      subject="Property Income Analysis"
    >
      <Page1Verdict data={data} chrome={chrome} nav={nav("verdict")} contents={contentsFor(sections)} />
      <Page2Numbers data={data} chrome={chrome} nav={nav("numbers")} />
      <Page3Market data={data} chrome={chrome} nav={nav("market")} />
      <Page4Location data={data} chrome={chrome} nav={nav("location")} />
      {/* `cond ? x : null`, never `cond && x`: a false child is a render error. */}
      {data.setup ? (
        <Page5Setup data={data} chrome={chrome} nav={nav("setup")} monthlyGain={data.strVsLtl.monthlyDiff} />
      ) : null}
      {data.deal ? <PageDeal deal={data.deal} chrome={chrome} nav={nav("deal")} /> : null}
      {data.diligence ? <PageDiligence data={data.diligence} chrome={chrome} nav={nav("diligence")} /> : null}
      <Page6Plan data={data} chrome={chrome} nav={nav("plan")} />
    </Document>
  );
}
