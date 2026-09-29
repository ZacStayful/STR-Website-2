import { runDealCalibration } from "@/lib/deal-quality/calibrate-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Deal checks, Step 0: the comparison with past full analyses ──────
// Re-runs 24 stored analyser reports through the deal check's own
// comparables search and records how far the new figures land from the
// stored ones (src/lib/deal-quality/calibrate-run.ts, shared with the
// /admin/demand buttons). At most 72 Airbtics calls (£3.60) for the whole
// comparison, house spend; each run carries on where the last stopped.
//
//   ?dry=1     list the cases still to run and the most they can cost; spends nothing
//   ?reset=1   start the comparison again on the same cases, with a fresh
//              ceiling (the earlier results stay recorded); spends nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/deal-comps-calibrate?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const reset = params.get("reset") === "1";
  const dry = !reset && params.get("dry") === "1";
  const result = await runDealCalibration({ dry, reset, triggeredBy: "internal" });
  return Response.json(result.body, { status: result.status });
}
