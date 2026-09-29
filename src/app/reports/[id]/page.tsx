import type { Metadata } from "next";
import { notFound } from "next/navigation";
import EstimatePage from "@/app/estimate/page";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { payerFor } from "@/lib/team";
import { quoterFor } from "@/lib/credit/quote-server";
import { enhancedEnabled } from "@/lib/analysis/run";
import type { AnalysisResult } from "@/lib/types";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { parseReportProject } from "@/lib/project/report";
import { reportProjectMineFor } from "@/lib/project/report-server";

export const metadata: Metadata = {
  title: "Saved report — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/** Reopens a saved report. RLS restricts the row to its owner (and their team); anything else is a 404. */
export default async function SavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  // deal_id / analysed_at mark a Full analysis of a feed deal (Batch 10). Read
  // apart from the report, so a database without those columns yet still
  // opens every report as before.
  const { data } = await supabase.from("saved_searches").select("result").eq("id", id).maybeSingle();
  const result = data?.result as AnalysisResult | undefined;
  if (!result || !result.property || !result.financials) notFound();
  const { data: meta } = await supabase.from("saved_searches").select("deal_id, analysed_at").eq("id", id).maybeSingle();
  const dealId = (meta?.deal_id as string | null | undefined) ?? null;
  const analysedAt = (meta?.analysed_at as string | null | undefined) ?? null;

  let pmi = null;
  // Batch 17: a Project deal's report shows the reader's own locked figures beside ours, read now and never stored on the report.
  const hasProject = Boolean(dealId && parseReportProject(result.project));
  const user = dealId && ((!result.secondOpinion && enhancedEnabled(true)) || hasProject) ? (await supabase.auth.getUser()).data.user : null;
  if (user && dealId && !result.secondOpinion && enhancedEnabled(true)) {
    const { payerId } = await payerFor(user.id);
    const quoter = await quoterFor(payerId, isAdminEmail(user.email));
    pmi = quoter.label(quoter.pricing.pmiAddonPence);
  }
  const projectMine = user && dealId && hasProject && hasServiceRole() ? await reportProjectMineFor(createAdminClient(), user.id, dealId) : null;

  return <EstimatePage initialResult={{ ...result, reportId: id }} savedAnalysis={dealId ? { dealId, analysedAt, pmi, projectMine } : undefined} />;
}
