import { runMarketplaceRecheck, recheckEnabled } from "@/lib/marketplace/recheck-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Deals marketplace recheck ────────────────────────────────────────
// Vercel cron (vercel.json: hourly). Retires deals that have aged out, then
// reads up to the per-portal cap of listing pages in priority order. The run
// lives in src/lib/marketplace/recheck-run.ts, shared with /admin/deals.
//
//   ?dry=1   list what would be retired and fetched; fetches and writes nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/marketplace-recheck?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  if (!recheckEnabled() && !dry) return Response.json({ enabled: false, reason: "MARKETPLACE_RECHECK_ENABLED is 'false'" });
  const result = await runMarketplaceRecheck({ dry });
  return Response.json(result.body, { status: result.status });
}
