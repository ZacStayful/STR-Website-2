import { retireUncheckedLive, runDealRecheck } from "@/lib/deal-quality/recheck-comps-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── The one-off re-check of live deals (Batch 16, Part B) ────────────
// Not a cron: run by hand (or from /admin/deals) once the checks are on, so
// every deal already live gets its own comparables check. Sales by annual
// profit first, then rentals; each run carries on where the last stopped,
// within the job's ceiling (billing_settings.deal_checks
// recheckCeilingPence) and the day's cap. The run lives in
// src/lib/deal-quality/recheck-comps-run.ts.
//
//   ?dry=1       how many live deals are unchecked, what this run would
//                check first (area, bedrooms, profit: never an address),
//                the worst case and the expected cost; asks nothing, writes nothing
//   ?max=n       cap the checks this run
//   ?retire=1    instead: retire every unchecked live deal as `unchecked`
//                (the next sweep revives it onto the shortlist); with ?dry=1
//                only counts them
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/deal-recheck?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  const triggeredBy = request.headers.get("authorization") ? "cron" : "internal";
  if (params.get("retire") === "1") {
    const result = await retireUncheckedLive({ dry, triggeredBy });
    return Response.json(result.body, { status: result.status });
  }
  const max = Number(params.get("max"));
  const result = await runDealRecheck({ dry, max: Number.isFinite(max) && max > 0 ? Math.floor(max) : undefined, triggeredBy });
  return Response.json(result.body, { status: result.status });
}
