import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadSubscriptionEvents } from "@/lib/billing/churn-server";
import { cyclesCsv, cyclesFromEvents, cyclesOnPlan } from "@/lib/billing/churn";
import { oneOf, windowFor } from "../../picks/responses/windows";

// ─── Subscription cycles as a spreadsheet ───────────────────────────
// Admin only (same gate as the page). One row per paid spell, so a member who
// left and came back is two rows — which is the whole reason the event log
// exists, and would be lost by exporting profiles instead.
//
// Takes the same query params as the page, through the same windows.ts, so
// "Download CSV" hands back what is on screen and the two cannot drift.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Not found" }, { status: 404 });

  const sp = new URL(request.url).searchParams;
  const timeWindow = windowFor(oneOf(sp.get("days")));
  const plan = oneOf(sp.get("plan"));

  const now = new Date();
  const events = await loadSubscriptionEvents().catch(() => []);
  const cycles = cyclesOnPlan(cyclesFromEvents(events, now), plan);

  // The window is about when people LEFT, so it never drops a live cycle —
  // matching the page, where a live member is in the stability figures however
  // the window is set.
  const since = timeWindow.days === null ? null : new Date(now.getTime() - timeWindow.days * 86_400_000).toISOString();
  const rows = since === null ? cycles : cycles.filter((c) => c.endedAt === null || c.endedAt >= since);

  const stamp = now.toISOString().slice(0, 10);
  const suffix = [plan ?? null, timeWindow.key === "all" ? null : `${timeWindow.days}d`].filter(Boolean).join("-");

  return new Response(cyclesCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="churn-${stamp}${suffix ? `-${suffix}` : ""}.csv"`,
      "cache-control": "no-store",
    },
  });
}
