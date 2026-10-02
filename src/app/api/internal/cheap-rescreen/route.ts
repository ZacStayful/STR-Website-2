import { runCheapRescreen } from "@/lib/deal-quality/cheap-rescreen-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Stored listings: the cheap re-screen (Batch 22c) ────
// Sale listings the searches already stored, at an asking price within
// billing_settings.low_entry.cheapMaxPrice, seen in the last few days, that
// never became a deal are screened again on today's figures; those that now
// qualify go into the pool as any newcomer does
// (src/lib/deal-quality/cheap-rescreen-run.ts, shared with the /admin/deals
// buttons). Idempotent. No provider call, no spend.
//
//   ?dry=1   the report: how many candidates, how they screen, and the ones a
//            run would add (never an address); changes nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/cheap-rescreen?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const result = await runCheapRescreen({ dry, triggeredBy: "internal" });
  return Response.json(result.body, { status: result.status });
}
