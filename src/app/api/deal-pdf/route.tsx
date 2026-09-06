import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { sharedListingByToken } from "@/lib/listing/share";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import { formatListingPrice } from "@/lib/listing/format";
import { pdfDealFrom } from "@/lib/pdf/derive";
import { DealSheet, type DealSheetData } from "@/lib/pdf/deal/DealSheet";

export const runtime = "nodejs";

/** Public PDF of a shared deal sheet, addressed by its share token. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const l = await sharedListingByToken(token);
  if (!l) return Response.json({ error: "Not found" }, { status: 404 });
  const est = l.quick?.estimate ?? null;
  const area = l.quick?.area ?? null;
  const data: DealSheetData = {
    title: l.title,
    address: l.displayAddress ?? l.postcode,
    sourceLabel: SOURCE_LABELS[l.source],
    sourceUrl: l.canonicalUrl,
    price: l.price ? formatListingPrice(l.price) : null,
    bedrooms: l.bedrooms,
    estimate: est ? { revenue: est.grossRevenue, adr: est.adr, occupancy: est.occupancy, note: est.note } : null,
    area: area ? { name: area.name, score: area.score, grade: area.grade, competition: area.competition?.label ?? null, directBooking: area.directBooking?.label ?? null, licensing: area.licensing.headline } : null,
    tracked: l.quick?.tracked ? { revenue: l.quick.tracked.annualRevenue, adr: l.quick.tracked.adr, occupancy: l.quick.tracked.occupancy, reviews: l.quick.tracked.reviewCount } : null,
    deal: l.deal ? pdfDealFrom({ ...l.deal, basis: l.kind === "rent" ? "advertised-rent" : "asking-price" }, l.canonicalUrl, []) : null,
    generatedAt: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
  };
  const buffer = await renderToBuffer(<DealSheet data={data} />);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Stayful_Deal_Sheet.pdf"`, "Cache-Control": "no-store" },
  });
}
