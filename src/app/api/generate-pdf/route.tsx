import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { AnalysisResult } from "@/lib/types";
import { deriveReportData, buildSetupSnapshot, buildPdfDeal, sanitiseAddressForFilename } from "@/lib/pdf/derive";
import type { PdfExpenses } from "@/lib/pdf/derive";
import { StayfulReport } from "@/lib/pdf/StayfulReport";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { funnelByToken } from "@/lib/funnels";

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

  const data = deriveReportData(body, body.expenses);
  data.deal = buildPdfDeal(body);
  if (body.setup) {
    const snap = buildSetupSnapshot(body.setup);
    if (snap) data.setup = snap;
  }
  const buffer = await renderToBuffer(<StayfulReport data={data} />);

  const filename = `Stayful_Property_Analysis_${sanitiseAddressForFilename(body.property.address)}.pdf`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
