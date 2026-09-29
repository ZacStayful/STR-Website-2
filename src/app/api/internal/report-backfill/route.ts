import { runReportBackfill } from "@/lib/deal-quality/backfill-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Past reports: the Monday backfill clean-up (Batch 16, Part D) ────
// The 409 rows read out of past analysis PDFs get their postcode, location
// and comparables' figures back; exact duplicates and earlier analyses of the
// same file are archived in analyser_reports_removed, then deleted
// (src/lib/deal-quality/backfill-run.ts, shared with the /admin/demand
// buttons). Idempotent; a run that runs out of time carries on next time.
// Google geocoding, ~0.4p a postcode, house spend.
//
//   ?dry=1   count what it would remove, fill and geocode, and the cost; changes nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/report-backfill?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const result = await runReportBackfill({ dry, triggeredBy: "internal" });
  return Response.json(result.body, { status: result.status });
}
