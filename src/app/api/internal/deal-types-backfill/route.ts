import { runDealTypesBackfill } from "@/lib/profile/deal-types-backfill-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Deal types: the one-off move of existing profiles (Batch 17, Part I) ────
// Every profile's older answers become "Which deals do you want to see?"
// (src/lib/profile/deal-types-backfill.ts, shared with the /admin/profiles
// button). Idempotent: a profile that has types is left alone, so a second
// run changes nothing. No provider calls, no charges, no activity logged.
//
//   ?dry=1   every profile's before and after (short ids, option keys); writes nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/deal-types-backfill?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const result = await runDealTypesBackfill({ dry, triggeredBy: "internal" });
  return Response.json(result.body, { status: result.status });
}
