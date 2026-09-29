import { runDealChecks } from "@/lib/deal-quality/checks-run";
import { dealChecksEnabled } from "@/lib/deal-quality/settings-server";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── The daily paid checks (Batch 16, Part B) ─────────────────────────
// Vercel cron (vercel.json: 03:40, 03:50, 04:00, 04:10 and 04:20 UTC, before
// the 04:30 recheck reads the entry pages and long before the morning
// emails). Each pass takes the day's checks from the shortlist by stream
// (billing_settings.deal_checks), searches each deal's own comparables and
// re-screens it on them, within the day's cap. The run lives in
// src/lib/deal-quality/checks-run.ts, shared with /admin/deals.
//
// OFF until DEAL_CHECKS_ENABLED=true (with it off nothing is shortlisted).
// A dry run works either way.
//
//   ?dry=1    the day's slots by stream, what this pass would check (area,
//             bedrooms, stream, profit: never an address), the worst-case
//             cost and what the day's cap has left; asks nothing, writes nothing
//   ?max=n    cap the checks this pass (default: the day's slots)
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/deal-checks?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  if (!dealChecksEnabled() && !dry) return Response.json({ enabled: false, reason: "DEAL_CHECKS_ENABLED is not 'true'" });
  const max = Number(params.get("max"));
  const result = await runDealChecks({
    dry,
    max: Number.isFinite(max) && max > 0 ? Math.floor(max) : undefined,
    // Vercel's cron sends the CRON_SECRET bearer; a hand-run curl sends x-internal-secret.
    triggeredBy: request.headers.get("authorization") ? "cron" : "internal",
  });
  return Response.json(result.body, { status: result.status });
}
