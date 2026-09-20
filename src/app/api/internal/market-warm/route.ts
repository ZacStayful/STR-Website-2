import { getAreaCards } from "@/lib/market/cached";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Market snapshot warm-up ────────────────────────────────────────
// Vercel cron (vercel.json), 06:45 UTC: builds the hourly-cached market
// snapshot (`getAreaCards`, hundreds of PropertyData calls on a cold cache)
// so the daily picks passes at 07:00 / 07:20 / 07:40 find it ready instead
// of spending their own budget on it. Harmless when the cache is warm.
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/market-warm"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const cards = await getAreaCards().catch((err) => {
    console.error("[market-warm] snapshot build failed:", (err as Error)?.message ?? err);
    return [];
  });
  const body = { cards: cards.length, ms: Date.now() - started };
  console.log("[market-warm]", JSON.stringify(body));
  return Response.json(body, { status: cards.length > 0 ? 200 : 503 });
}
