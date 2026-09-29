import { runProjectBackfill } from "@/lib/project/live-backfill-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Live deals whose words say they need work: the one-off Project backfill (Batch 17, Q16) ────
// The entry hold only sees listings coming in, so the sale deals that went
// live before it was switched on, and whose own words say they need work,
// go through the same decision once, here: held back on the shortlist for
// their Project check, retired as a newcomer would be (a listing that can
// never be a Project deal), or left live (src/lib/project/live-backfill-run.ts,
// shared with the /admin/deals buttons). Reads only what is stored: no page
// fetch, no spend. A real run needs the Project checks on. Idempotent; a run
// that runs out of time carries on next time.
//
//   ?dry=1   counts and a sample (area, bedrooms, type, the phrases, the
//            decision; never an address); changes nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/project-backfill?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const result = await runProjectBackfill({ dry, triggeredBy: "internal" });
  return Response.json(result.body, { status: result.status });
}
