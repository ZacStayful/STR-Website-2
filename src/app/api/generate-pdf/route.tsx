import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { AnalysisResult } from "@/lib/types";
import { deriveReportData, buildSetupSnapshot, sanitiseAddressForFilename } from "@/lib/pdf/derive";
import { StayfulReport } from "@/lib/pdf/StayfulReport";

export const runtime = "nodejs";

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
}

export async function POST(request: Request) {
  let body: PdfRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (!body?.property?.address || !body?.financials) {
    return new Response("Missing required analysis data", { status: 400 });
  }

  const data = deriveReportData(body);
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
