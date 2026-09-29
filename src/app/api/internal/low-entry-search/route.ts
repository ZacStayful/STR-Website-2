import { lowEntrySearchEnabled, runLowEntrySearch } from "@/lib/deal-quality/low-entry-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── The nationwide low-entry search (Batch 16, Part F) ───────────────
// Vercel cron (vercel.json: 03:00, 03:10 and 03:20 UTC, before the sweep).
// Each pass searches the next slice of every UK postcode area for sale
// listings up to the low-entry price cap (billing_settings.low_entry), so
// each area comes round about weekly, within the week's spend cap. The run
// lives in src/lib/deal-quality/low-entry-run.ts, shared with /admin/deals.
//
// OFF until LOW_ENTRY_SEARCH_ENABLED=true. A dry run works either way.
//
//   ?dry=1    list the areas the pass would search (and which are screened on
//             their region's figures), the worst-case cost, the week's spend
//             and what is left under the cap; asks nothing, writes nothing
//   ?max=n    cap the searches this pass (default: the setting's areasPerPass)
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/low-entry-search?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  if (!lowEntrySearchEnabled() && !dry) return Response.json({ enabled: false, reason: "LOW_ENTRY_SEARCH_ENABLED is not 'true'" });
  const max = Number(params.get("max"));
  const result = await runLowEntrySearch({
    dry,
    maxQueries: Number.isFinite(max) && max > 0 ? Math.floor(max) : undefined,
    // Vercel's cron sends the CRON_SECRET bearer; a hand-run curl sends x-internal-secret.
    triggeredBy: request.headers.get("authorization") ? "cron" : "internal",
  });
  return Response.json(result.body, { status: result.status });
}
