import { runSweep, sweepEnabled } from "@/lib/marketplace/sweep-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Deals marketplace sweep ──────────────────────────────────────────
// Vercel cron (vercel.json: every 10 minutes 05:00–06:50 UTC, twelve
// resumable passes that finish before the 07:00 picks). The run itself lives
// in src/lib/marketplace/sweep-run.ts, shared with /admin/deals.
//
//   ?dry=1    list the queries, the raw cost estimate and the PMI credits
//             remaining; asks nothing, writes nothing
//   ?max=n    cap the queries this pass
//   ?areas=n  override MARKETPLACE_SWEEP_AREAS (default 60)
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/marketplace-sweep?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  if (!sweepEnabled() && !dry) return Response.json({ enabled: false, reason: "MARKETPLACE_SWEEP_ENABLED is 'false'" });
  const max = Number(params.get("max"));
  const areas = Number(params.get("areas"));
  const result = await runSweep({ dry, maxQueries: Number.isFinite(max) && max > 0 ? max : undefined, areas: Number.isFinite(areas) && areas > 0 ? areas : undefined });
  return Response.json(result.body, { status: result.status });
}
