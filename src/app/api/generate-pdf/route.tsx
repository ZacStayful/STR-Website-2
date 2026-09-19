import type { AnalysisResult } from "@/lib/types";
import type { PdfExpenses } from "@/lib/pdf/derive";
import { renderReportPdf, pdfBrandForFunnel, reportFilename } from "@/lib/pdf/render";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { funnelByToken } from "@/lib/funnels";
import type { PdfBrand } from "@/lib/pdf/theme";

export const runtime = "nodejs";

/**
 * Rendering a PDF is unmetered compute, so this route is gated: a signed-in
 * member, or a live funnel token for a prospect downloading their own report.
 * It previously accepted any POST from anyone, which let a stranger spend our
 * CPU rendering arbitrary payloads.
 */
async function authorised(request: Request): Promise<boolean> {
  const token = new URL(request.url).searchParams.get("f");
  if (token) return Boolean(await funnelByToken(token));
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return Boolean(data.user);
  } catch {
    return false;
  }
}

/**
 * The branding for this render. A funnel's report must not say Stayful
 * anywhere — not in the header, not in the footer, not in the document
 * properties a reader shows — or the white-label promise breaks at the last
 * step, after the page itself got it right.
 */
async function brandFor(request: Request): Promise<PdfBrand | undefined> {
  const token = new URL(request.url).searchParams.get("f");
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
}

export async function POST(request: Request) {
  if (!(await authorised(request))) {
    return new Response("Not authorised", { status: 401 });
  }

  let body: PdfRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (!body?.property?.address || !body?.financials) {
    return new Response("Missing required analysis data", { status: 400 });
  }

  const brand = await brandFor(request);
  const buffer = await renderReportPdf(body, { brand, expenses: body.expenses, setup: body.setup });
  const filename = reportFilename(body, brand);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
