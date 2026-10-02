import { runRestreamBackfill } from "@/lib/deal-quality/restream-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Stored deals: the re-stream backfill (Batch 22c) ────
// The low-entry stream now means a cheap price (asking price at most
// billing_settings.low_entry.cheapMaxPrice, an auction lot at its auction
// price). Every deal still in play has its stream column worked out again;
// a Project deal keeps its own (src/lib/deal-quality/restream-run.ts, shared
// with the /admin/deals buttons). Idempotent. No network, no spend.
//
//   ?dry=1   the report: counts per stream before and after, and the rows
//            that would move (never an address); changes nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/restream-backfill?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const result = await runRestreamBackfill({ dry, triggeredBy: "internal" });
  return Response.json(result.body, { status: result.status });
}
