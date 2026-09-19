import type { Metadata } from "next";
import { notFound } from "next/navigation";
import EstimatePage from "@/app/estimate/page";
import { funnelByToken } from "@/lib/funnels";
import { brandCssVars, brandName } from "@/lib/funnels/brand";
import type { FunnelMode } from "@/lib/funnels/mode";
import { DEMO_MAP } from "@/lib/demo-data";

export const dynamic = "force-dynamic";

/**
 * A customer's white-label lead funnel.
 *
 * Public by design: the token in the URL is the whole credential, there is no
 * session, and the prospect filling this in never gets an account. The run is
 * charged to the funnel's OWNER — see the analyse route for the guards that
 * makes necessary.
 *
 * `noindex` for the same reason /p and /deal are: a customer's funnel hosted
 * on our domain must never compete with their own site in search results.
 *
 * ?preview=1 shows the branded FORM, which is what a prospect meets first and
 * where the logo, colours and consent wording live. ?preview=report shows the
 * finished report against demo data. Neither spends anything, so a customer
 * can check their own branding without paying for a lead to look at it.
 */

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const funnel = await funnelByToken(token);
  const name = funnel ? brandName(funnel.brand) : "Property income analysis";
  return {
    title: name,
    description: `Find out what a property could earn as a short-term let, from ${name}.`,
    robots: { index: false, follow: false },
    // The root layout's Stayful favicons would otherwise carry through onto a
    // page that is supposed to look like someone else's.
    icons: funnel?.brand.logoUrl ? { icon: funnel.brand.logoUrl } : { icon: "/favicon.ico" },
  };
}

export default async function FunnelPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const [{ token }, { preview }] = await Promise.all([params, searchParams]);
  const funnel = await funnelByToken(token);
  // A paused or deleted funnel reads as missing, so pausing is an instant off.
  if (!funnel) notFound();

  const isPreview = preview === "1" || preview === "report";
  const previewReport = preview === "report";
  const mode: FunnelMode = {
    token,
    brand: funnel.brand,
    reportDepth: funnel.reportDepth,
    preview: isPreview,
  };

  // Setting the raw custom properties on this wrapper re-themes everything
  // underneath: `@theme inline` in globals.css bridges them to every
  // bg-background / text-primary / border-border utility, so the analyser and
  // even the address autocomplete pick up the customer's colours with no
  // component changes at all.
  const style = brandCssVars(funnel.brand) as React.CSSProperties;

  return (
    <div style={style}>
      {isPreview ? (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-foreground px-4 py-2 text-center text-xs font-medium text-background">
          <span>
            Preview of your {previewReport ? "report" : "form"} — nothing here is charged or saved.
          </span>
          <a
            href={`?preview=${previewReport ? "1" : "report"}`}
            className="underline underline-offset-2"
          >
            {previewReport ? "See the form instead" : "See the report instead"}
          </a>
        </div>
      ) : null}
      <EstimatePage funnel={mode} initialResult={previewReport ? DEMO_MAP.manchester : undefined} />
    </div>
  );
}
