import { revalidateTag } from "next/cache";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { areaCentroid } from "@/lib/market/area-centroids";
import { areasToRefresh, PLANNING_MAX_AGE_DAYS, PLANNING_RADIUS_KM, type PlanningSignal } from "@/lib/market/planning";
import { countLargeApplicationsBothWindows } from "@/lib/apis/planit";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Planning signals refresh ──────────────────────────────────────────
// Vercel cron (vercel.json, daily). For every postcode area that has
// analyser reports, count the large planning applications PlanIt holds
// within PLANNING_RADIUS_KM of the area's centre over the last 12 months
// and the 12 before, and store them in area_planning_signals. They feed
// the "contractor projects" driver of direct-booking potential. Areas
// with no signal, then the stalest, go first, a few at a time (a PlanIt
// count over a city can take 20–30 s); a run stops at its time budget and
// the next run carries on, so each area refreshes about monthly
// (PLANNING_MAX_AGE_DAYS).
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/planning-signals?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;
const MAX_PER_RUN = 9;
const CONCURRENCY = 3;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const admin = createAdminClient();
  const started = Date.now();
  const now = new Date();

  const [{ data: areaRows, error: areaError }, { data: signalRows, error: signalError }] = await Promise.all([
    admin.from("analyser_reports").select("postcode_area").gt("gross_revenue", 0).not("postcode_area", "is", null),
    admin.from("area_planning_signals").select("postcode_area, large_apps_12m, large_apps_prev_12m, fetched_at"),
  ]);
  if (areaError || signalError) return Response.json({ error: (areaError ?? signalError)!.message }, { status: 500 });

  const codes = [...new Set(((areaRows ?? []) as { postcode_area: string }[]).map((r) => r.postcode_area.trim().toUpperCase()))];
  const signals = ((signalRows ?? []) as PlanningSignal[]).map((s) => ({ ...s, postcode_area: s.postcode_area.toUpperCase() }));
  const due = areasToRefresh(codes, signals, now).filter((c) => areaCentroid(c) !== null);

  const done: { area: string; large_apps_12m: number; large_apps_prev_12m: number }[] = [];
  const failed: string[] = [];
  const queue = due.slice(0, MAX_PER_RUN);
  const worker = async () => {
    for (let code = queue.shift(); code; code = queue.shift()) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        queue.unshift(code);
        return;
      }
      if (dry) {
        done.push({ area: code, large_apps_12m: -1, large_apps_prev_12m: -1 });
        continue;
      }
      const c = areaCentroid(code)!;
      const counts = await countLargeApplicationsBothWindows(c.lat, c.lng, PLANNING_RADIUS_KM, now);
      if (!counts) {
        failed.push(code);
        continue;
      }
      const { error } = await admin
        .from("area_planning_signals")
        .upsert({ postcode_area: code, lat: c.lat, lng: c.lng, radius_km: PLANNING_RADIUS_KM, large_apps_12m: counts.recent, large_apps_prev_12m: counts.prior, fetched_at: now.toISOString(), source: "planit" }, { onConflict: "postcode_area" });
      if (error) {
        console.error("[planning-signals] upsert failed:", error.message);
        failed.push(code);
        continue;
      }
      done.push({ area: code, large_apps_12m: counts.recent, large_apps_prev_12m: counts.prior });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // The snapshot is built from these signals: rebuild it on the next request.
  if (!dry && done.length > 0) revalidateTag("market-area-cards", "max");

  return Response.json({
    dry,
    areas: codes.length,
    due: due.length,
    maxAgeDays: PLANNING_MAX_AGE_DAYS,
    radiusKm: PLANNING_RADIUS_KM,
    refreshed: done.length,
    remaining: Math.max(0, due.length - done.length - failed.length),
    failed,
    done,
    ms: Date.now() - started,
  });
}
