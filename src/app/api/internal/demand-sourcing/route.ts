import { demandSourcingEnabled, runDemandSourcing } from "@/lib/sourcing-demand/run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Demand-led sourcing (Batch 15) ───────────────────────────────────
// Vercel cron (vercel.json: every 10 minutes 05:05–06:55 UTC, between the
// marketplace sweep's passes so the two never overlap). Searches the areas
// members' running profiles want that the sweep does not cover, within the
// monthly provider-spend cap (billing_settings.demand_monthly_cap_pence). The
// run lives in src/lib/sourcing-demand/run.ts, shared with /admin/demand.
//
// OFF until DEMAND_SOURCING_ENABLED=true. A dry run works either way.
//
//   ?dry=1    list what it would search in order, each search's worst-case
//             cost, the month's spend and what is left under the cap, and
//             every skipped area with its reason; asks nothing, writes nothing
//   ?max=n    cap the searches this pass (default 8)
//   ?cap=p    lower the monthly cap to p pence for this pass (testing); it can
//             never raise it
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/demand-sourcing?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  if (!demandSourcingEnabled() && !dry) return Response.json({ enabled: false, reason: "DEMAND_SOURCING_ENABLED is not 'true'" });
  const max = Number(params.get("max"));
  const capRaw = params.get("cap");
  let capPence: number | null = null;
  if (capRaw !== null) {
    capPence = Number(capRaw);
    // A cap that cannot be read must not quietly become the full cap.
    if (capRaw.trim() === "" || !Number.isFinite(capPence) || capPence < 0) return Response.json({ error: "cap must be a number of pence, 0 or more" }, { status: 400 });
  }
  const result = await runDemandSourcing({
    dry,
    maxQueries: Number.isFinite(max) && max > 0 ? Math.floor(max) : undefined,
    capPence,
    // Vercel's cron sends the CRON_SECRET bearer; a hand-run curl sends x-internal-secret.
    triggeredBy: request.headers.get("authorization") ? "cron" : "internal",
  });
  return Response.json(result.body, { status: result.status });
}
