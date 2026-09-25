import type { Metadata } from "next";
import { notFound } from "next/navigation";
import EstimatePage from "@/app/estimate/page";
import { leadByReportToken } from "@/lib/leads/report";
import { brandCssVars, brandName } from "@/lib/funnels/brand";
import type { FunnelMode } from "@/lib/funnels/mode";
import { MarkReportOpened } from "./MarkReportOpened";

export const dynamic = "force-dynamic";

/**
 * The prospect's own copy of their report.
 *
 * They have no account — that is the whole premise of a funnel — so the
 * report lives at an unguessable token URL instead, the same shape as /p and
 * /deal. Without this the link we put in the customer's CRM would be dead,
 * which is worse than sending no link at all.
 *
 * Read through the service role: `leads` is RLS-on with a select-own policy,
 * and the person opening this has no session to be "own" of. The token IS
 * the credential, so the lookup returns only what a prospect may see — never
 * the qualification verdict, which is the customer's business, and never the
 * owner's id.
 *
 * `noindex`, like every other token page here: a prospect's name, home
 * address and projected income must not turn up in a search result.
 */

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const lead = await leadByReportToken(token);
  const name = lead ? brandName(lead.brand) : "Property income analysis";
  return {
    title: `Your property report · ${name}`,
    description: `Your short-term let income analysis from ${name}.`,
    robots: { index: false, follow: false },
    icons: lead?.brand.logoUrl ? { icon: lead.brand.logoUrl } : { icon: "/favicon.ico" },
  };
}

export default async function LeadReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lead = await leadByReportToken(token);
  // No report yet is the same as no report: a lead captured while its owner
  // was short of credit has a token but nothing to show, and "we are still
  // preparing it" is what the funnel already told them.
  if (!lead || !lead.result) notFound();

  const mode: FunnelMode = {
    token: lead.funnelToken,
    brand: lead.brand,
    reportDepth: lead.reportDepth,
    // Not a preview: this is their real report. The flag exists so the page
    // knows not to offer to run another one.
    preview: false,
    // Download through this lead, not the funnel: the funnel token only
    // works while the funnel is live, and this report outlives that.
    reportToken: token,
  };

  const style = brandCssVars(lead.brand) as React.CSSProperties;

  return (
    <div style={style}>
      <MarkReportOpened token={token} />
      <EstimatePage funnel={mode} initialResult={lead.result} />
    </div>
  );
}
