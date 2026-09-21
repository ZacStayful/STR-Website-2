import { BRAND } from "../brand.ts";

export const PDF_COLORS = {
  DARK_GREEN: "#5f8257",
  DARK_GREEN_2: "#64826c",
  CREAM: "#d1d9bd",
  MINT_GREEN: "#badac9",
  DARK_GREY: "#5b615f",
  LIGHT_GREY: "#b8bcbc",
  OFF_WHITE: "#f7f5f0",
  WHITE: "#ffffff",
  ROW_STRIPE: "#f9f8f5",
} as const;

export const PDF_COST_RATES = {
  PLATFORM: 0.15,
  MANAGEMENT: 0.15,
  CLEANING: 0.18,
  TOTAL: 0.48,
  LTL_AGENT: 0.10,
} as const;

// ─── White-label branding ─────────────────────────────────────────────
//
// The report a prospect downloads from a customer's funnel must not say
// Stayful on it. Rather than convert every module-scope StyleSheet in this
// folder into a factory — ten files, all of them load-bearing for the
// members-only report — the brand is threaded through `PdfReportData` and
// applied where it actually shows: the fixed header and footer that appear
// on every page, and the document metadata.

export interface PdfBrand {
  /** Shown in the header bar and the footer. */
  companyName: string;
  /** Footer line under the name: a website, a phone number, or both. */
  contactLine: string;
  /** Header bar background. Defaults to Stayful's green. */
  primary: string;
  /** Text on the header bar; derived, so a brand colour cannot hide it. */
  onPrimary: string;
  /**
   * A data URI for the logo, already fetched and validated. A URL is
   * deliberately not accepted: react-pdf would fetch it during render with
   * no timeout, so one slow host would hang a report.
   */
  logoDataUri?: string;
  /**
   * Where the report's call to action sends someone. Deliberately never
   * defaulted for a supplied brand: a white-label report carrying Stayful's
   * booking link would be exactly the leak this module exists to prevent.
   * Absent means the page drops the button and the QR code.
   */
  bookingUrl?: string;
  /** The reply-to on the call to action. Absent means no email line. */
  ctaEmail?: string;
}

export const DEFAULT_PDF_BRAND: PdfBrand = {
  // Sentence case: page six reads "How Stayful grows your returns", and the
  // chrome uppercases it where the design calls for that.
  companyName: "Stayful",
  contactLine: `stayful.co.uk · ${BRAND.reportEmail}`,
  primary: PDF_COLORS.DARK_GREEN,
  onPrimary: PDF_COLORS.WHITE,
  bookingUrl: BRAND.bookingUrl,
  ctaEmail: BRAND.reportEmail,
};

/**
 * Black or white, whichever stays readable on the given colour. WCAG
 * relative luminance rather than a channel average, which misjudges greens
 * and yellows badly.
 */
export function readableOnPdf(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return PDF_COLORS.WHITE;
  const channel = (h: string) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel(c.slice(0, 2)) + 0.7152 * channel(c.slice(2, 4)) + 0.0722 * channel(c.slice(4, 6));
  return l > 0.179 ? "#111111" : PDF_COLORS.WHITE;
}

/** Fills in whatever a customer did not set, so a page always has a brand. */
export function pdfBrand(input: Partial<PdfBrand> | null | undefined): PdfBrand {
  if (!input) return DEFAULT_PDF_BRAND;
  const primary = input.primary ?? DEFAULT_PDF_BRAND.primary;
  return {
    companyName: input.companyName?.trim() || DEFAULT_PDF_BRAND.companyName,
    contactLine: input.contactLine?.trim() ?? "",
    primary,
    onPrimary: input.onPrimary ?? readableOnPdf(primary),
    logoDataUri: input.logoDataUri,
    // Not filled in from the default: see the note on PdfBrand.bookingUrl.
    bookingUrl: input.bookingUrl,
    ctaEmail: input.ctaEmail,
  };
}
