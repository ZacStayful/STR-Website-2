import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadResponses } from "@/lib/listing/picks-server";
import { filterResponses, responsesCsv } from "@/lib/listing/picks-patterns";
import { isPickReason, type PickReason } from "@/lib/listing/picks";

// ─── Pick responses as a spreadsheet ────────────────────────────────
// Admin only (same gate as the page). Takes the same query params as
// /admin/picks/responses, so "Download CSV" exports exactly what is on
// screen, with every row rather than the first 300.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS: Record<string, number | null> = { "30": 30, "90": 90, "365": 365, all: null };

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Not found" }, { status: 404 });

  const sp = new URL(request.url).searchParams;
  const daysKey = sp.get("days") ?? "90";
  const days = daysKey in DAYS ? DAYS[daysKey] : 90;
  const reason = sp.get("reason");
  const reaction = sp.get("reaction");
  const kind = sp.get("kind");
  const basis = sp.get("basis");

  const all = await loadResponses({ since: days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString() });
  const rows = filterResponses(all, {
    reaction: reaction === "yes" || reaction === "no" ? reaction : null,
    reason: isPickReason(reason) ? (reason as PickReason) : null,
    kind: kind === "sale" || kind === "rent" ? kind : null,
    basis: basis === "goals" || basis === "house" ? basis : null,
    area: sp.get("area"),
    q: sp.get("q"),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(responsesCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pick-responses-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
