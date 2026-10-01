import { memberSearchEnabled, runDueSearches } from "@/lib/sourcing-demand/member-search";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Members' own searches (Batch 22, Part G) ──────────────────────────
// Vercel cron (vercel.json: every 5 minutes). Continues or settles any
// member search left over: a signup search the quiz's kick did not finish,
// a deep search still running. The search itself lives in
// src/lib/sourcing-demand/member-search.ts.
//
// OFF until MEMBER_SEARCH_ENABLED=true. A dry run works either way.
//
//   ?dry=1    how many searches are due; runs nothing, writes nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/member-searches?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  if (!memberSearchEnabled() && !dry) return Response.json({ enabled: false, reason: "MEMBER_SEARCH_ENABLED is not 'true'" });
  const result = await runDueSearches({ dry, deadlineMs: 50_000 });
  return Response.json(result);
}
