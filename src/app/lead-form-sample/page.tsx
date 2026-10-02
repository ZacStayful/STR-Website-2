import type { Metadata } from "next";
import EstimatePage from "@/app/estimate/page";
import { DEMO_MAP } from "@/lib/demo-data";
import { brandCssVars, EMPTY_BRAND, type FunnelBrand } from "@/lib/funnels/brand";
import type { FunnelMode } from "@/lib/funnels/mode";

export const metadata: Metadata = {
  title: "Sample landlord report",
  robots: { index: false, follow: false },
};

/**
 * Batch 22f: the management page's sample — a branded landlord report in
 * preview mode, with demo data, for a made-up company. Nothing can be
 * submitted or charged from it (preview), and it carries no funnel token.
 */
// No colour of its own: the report shows in Stayful green, exactly as the analyser does.
const SAMPLE_BRAND: FunnelBrand = { ...EMPTY_BRAND, companyName: "Your Company Lettings" };

export default function LeadFormSample() {
  const funnel: FunnelMode = { token: "sample", brand: SAMPLE_BRAND, reportDepth: "standard", preview: true };
  return (
    <div style={brandCssVars(SAMPLE_BRAND) as React.CSSProperties}>
      <div className="bg-foreground px-4 py-2 text-center text-xs font-medium text-background">
        A sample report with demo data, in a made-up company&apos;s branding. Yours carries your name, logo and colour.
      </div>
      <EstimatePage funnel={funnel} initialResult={DEMO_MAP.manchester} />
    </div>
  );
}
