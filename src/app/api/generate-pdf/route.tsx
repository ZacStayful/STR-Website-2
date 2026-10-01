import type { AnalysisResult } from "@/lib/types";
import type { PdfExpenses } from "@/lib/pdf/derive";
import { renderReportPdf, pdfBrandForFunnel, reportFilename } from "@/lib/pdf/render";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { funnelByToken } from "@/lib/funnels";
import { leadByReportToken, type LeadReport } from "@/lib/leads/report";
import { touchLeadByReportToken } from "@/lib/leads/activity";
import type { PdfBrand } from "@/lib/pdf/theme";
import { logActivity } from "@/lib/activity/log";
import { parseReportProjectMine } from "@/lib/project/report";

export const runtime = "nodejs";

/**
 * Rendering a PDF is unmetered compute, so this route is gated: a signed-in
 * member, a live funnel token for a prospect downloading their own report,
 * or a lead's report token (`?r=`) — the finished report on /r/<token> or
 * the customer's lead page, which must keep downloading after its funnel is
 * paused or deleted.
 * It previously accepted any POST from anyone, which let a stranger spend our
 * CPU rendering arbitrary payloads.
 */
interface Caller {
  ok: boolean;
  /** The address for the report cover: the signed-in member's, or for a
   *  lead's report (`?r=`) the prospect it was prepared for — the same cover
   *  /r/<token>/pdf prints. A plain funnel download (`?f=`) stays anonymous. */
  email?: string;
  /** The signed-in member, when it is one (not a funnel prospect or a lead's report). */
  userId?: string;
  /** A lead's report (`?r=`): the stored analysis is what gets rendered, never the body's. */
  lead?: LeadReport;
}

async function authorised(request: Request): Promise<Caller> {
  const params = new URL(request.url).searchParams;
  const report = params.get("r");
  if (report) {
    // The cover names the prospect it was prepared for, as /r/<token>/pdf does.
    const lead = await leadByReportToken(report);
    return lead ? { ok: true, email: lead.email ?? undefined, lead } : { ok: false };
  }
  const token = params.get("f");
  if (token) return { ok: Boolean(await funnelByToken(token)) };
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return { ok: Boolean(data.user), email: data.user?.email ?? undefined, userId: data.user?.id };
  } catch {
    return { ok: false };
  }
}

/**
 * The branding for this render. A funnel's report must not say Stayful
 * anywhere — not in the header, not in the footer, not in the document
 * properties a reader shows — or the white-label promise breaks at the last
 * step, after the page itself got it right.
 */
async function brandFor(request: Request, caller: Caller): Promise<PdfBrand | undefined> {
  if (caller.lead) return pdfBrandForFunnel(caller.lead.brand);
  const params = new URL(request.url).searchParams;
  const token = params.get("f");
  if (!token) return undefined;
  const funnel = await funnelByToken(token);
  if (!funnel) return undefined;
  return pdfBrandForFunnel(funnel.brand);
}

interface PdfRequestBody extends AnalysisResult {
  setup?: {
    furnishing: "fully" | "part" | "unfurnished";
    bedrooms: number;
    items: Array<{
      id: string;
      name: string;
      category: string;
      supplier: string;
      qty: number;
      unitCost: number;
      active: boolean;
    }>;
  };
  expenses?: PdfExpenses;
  /** Batch 17: the downloader's own locked figures on a Project deal (the report page sends them). */
  projectMine?: unknown;
}

export async function POST(request: Request) {
  const caller = await authorised(request);
  if (!caller.ok) {
    return new Response("Not authorised", { status: 401 });
  }

  let body: PdfRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // Batch 21 (C23): a lead's token renders the lead's stored report, never a
  // body of the caller's choosing with the prospect's email on the cover. The
  // body may still carry the prospect's own setup and expense edits.
  const analysis: AnalysisResult = caller.lead ? caller.lead.result : body;
  if (!analysis?.property?.address || !analysis?.financials) {
    return new Response("Missing required analysis data", { status: 400 });
  }

  const brand = await brandFor(request, caller);
  const buffer = await renderReportPdf(analysis, {
    brand,
    expenses: body?.expenses,
    setup: body?.setup,
    preparedFor: caller.email,
    // Only a signed-in member's own download carries their figures; a funnel or lead report never has any.
    projectMine: caller.userId ? parseReportProjectMine(body.projectMine) : null,
  });
  const filename = reportFilename(analysis, brand);

  // Downloading a lead's report is using it (retention.ts).
  const report = new URL(request.url).searchParams.get("r");
  if (report) await touchLeadByReportToken(report);
  if (caller.userId) logActivity(caller.userId, "pdf_download", { extras: { what: "report" } });

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
