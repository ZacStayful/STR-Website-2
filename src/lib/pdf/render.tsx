import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { deriveReportData, buildPdfDeal, buildPdfDiligence, buildSetupSnapshot, sanitiseAddressForFilename } from "./derive";
import type { PdfExpenses } from "./derive";
import { StayfulReport } from "./StayfulReport";
import { pdfBrand, type PdfBrand } from "./theme";
import { logoDataUri } from "./brand-logo";
import type { FunnelBrand } from "../funnels/brand";
import type { AnalysisResult } from "../types";

/**
 * Rendering a report to a PDF, in one place.
 *
 * Two callers need the identical document: the route a prospect downloads
 * from, and the CRM delivery that attaches it to their lead in the
 * customer's Monday board. If those drifted, a customer would be looking at
 * a different report from the one their prospect has in front of them — the
 * kind of discrepancy nobody notices until it is being discussed on a call.
 */

export interface RenderOptions {
  brand?: PdfBrand;
  expenses?: PdfExpenses;
  setup?: Parameters<typeof buildSetupSnapshot>[0];
  /**
   * Who the report was produced for, printed on the cover. The analysis does
   * not carry an email, so each caller supplies the one it knows: the
   * signed-in member, the lead who filled in the funnel, or nothing.
   */
  preparedFor?: string;
}

export async function renderReportPdf(result: AnalysisResult, opts: RenderOptions = {}): Promise<Buffer> {
  const data = deriveReportData(result, opts.expenses);
  data.brand = opts.brand;
  // Left off the page entirely when unknown, never as a placeholder.
  if (opts.preparedFor) data.preparedFor = opts.preparedFor;
  data.deal = buildPdfDeal(result);
  data.diligence = buildPdfDiligence(result);
  if (opts.setup) {
    const snap = buildSetupSnapshot(opts.setup);
    if (snap) data.setup = snap;
  }
  // A Buffer rather than a plain Uint8Array: it satisfies both callers
  // (Buffer IS a Uint8Array) and keeps the Response body typing that the
  // route already had.
  return renderToBuffer(<StayfulReport data={data} />);
}

/**
 * Turns a funnel's web branding into the PDF's. Fetching the logo is the
 * slow part — see brand-logo.ts for the timeout and the format sniffing —
 * so a caller rendering several reports should resolve this once and pass
 * it to each render rather than paying for the fetch every time.
 *
 * Contact details are never invented. The footer carries the company name
 * and the reply-to the customer actually gave us and nothing else; a made-up
 * phone number on someone else's report would be worse than a bare footer.
 */
export async function pdfBrandForFunnel(brand: FunnelBrand): Promise<PdfBrand> {
  const name = brand.companyName ?? "Property income analysis";
  return pdfBrand({
    companyName: name,
    contactLine: [name, brand.replyToEmail].filter(Boolean).join(" · "),
    primary: brand.primary ?? undefined,
    logoDataUri: (await logoDataUri(brand.logoUrl)) ?? undefined,
    // The customer's own reply-to, so the report's call to action reaches
    // them. `bookingUrl` is deliberately left unset: a funnel has no booking
    // link to give, and ours must never appear on their report — page six
    // drops the button and the QR code rather than inventing either.
    ctaEmail: brand.replyToEmail ?? undefined,
  });
}

/** `<Company>_Property_Analysis_<address>.pdf`, safe for a filename anywhere. */
export function reportFilename(result: AnalysisResult, brand?: PdfBrand): string {
  const who = (brand?.companyName ?? "Stayful").replace(/[^A-Za-z0-9]+/g, "_");
  return `${who}_Property_Analysis_${sanitiseAddressForFilename(result.property.address)}.pdf`;
}
