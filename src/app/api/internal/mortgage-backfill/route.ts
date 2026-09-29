import { runMortgageBackfill } from "@/lib/listing/mortgage-backfill-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Stored deals: the one-off interest-only backfill (Batch 16b) ────
// Every stored purchase deal saved on the repayment formula is rewritten at
// the interest-only mortgage: marketplace_deals.deal, sourcing_sent.deal and
// checked_listings.deal with its quick_estimate.deal
// (src/lib/listing/mortgage-backfill-run.ts, shared with the /admin/deals
// buttons). Nothing else on a row changes. Idempotent; a run that runs out
// of time carries on next time. No network, no spend.
//
//   ?dry=1   the before/after report: rows to change per table, the live sale
//            deals on both formulas, five worked examples; changes nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/mortgage-backfill?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const result = await runMortgageBackfill({ dry, triggeredBy: "internal" });
  return Response.json(result.body, { status: result.status });
}
