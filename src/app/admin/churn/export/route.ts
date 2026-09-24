import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadSubscriptionEvents } from "@/lib/billing/churn-server";
import { cyclesCsv, cyclesFromEvents } from "@/lib/billing/churn";

// ─── Subscription cycles as a spreadsheet ───────────────────────────
// Admin only (same gate as the page). One row per paid spell, so a member who
// left and came back is two rows — which is the whole reason the event log
// exists, and would be lost by exporting profiles instead.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Not found" }, { status: 404 });

  const events = await loadSubscriptionEvents().catch(() => []);
  const csv = cyclesCsv(cyclesFromEvents(events, new Date()));
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="churn-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
