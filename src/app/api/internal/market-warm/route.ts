import { getAreaCards } from "@/lib/market/cached";
import { ask, pdMortgageRates } from "@/lib/broker";
import { warmAllRegionKeyStats } from "@/lib/market/key-stats-cache";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Market snapshot warm-up ────────────────────────────────────────
// Vercel cron (vercel.json), 04:45 UTC: buys the shared PropertyData answers
// (the national mortgage averages and, a few regions a day, the region key
// stats) as house spend, then builds the hourly-cached market snapshot
// (`getAreaCards`) so the daily picks passes at 07:00 / 07:20 / 07:40 find
// it ready instead of spending their own budget on it. Harmless when the
// cache is warm.
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/market-warm"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  // The national mortgage averages are house spend: bought here once a day
  // (one PropertyData credit) so a member's report only ever reads them.
  const rates = await ask(pdMortgageRates, {}, { mode: "cron" });
  // Region key stats: 30 credits a region, at most four regions a run, so a
  // full refresh spreads over three days each month.
  const keyStats = await warmAllRegionKeyStats().catch((err) => {
    console.error("[market-warm] key stats warm-up failed:", (err as Error)?.message ?? err);
    return null;
  });
  const cards = await getAreaCards().catch((err) => {
    console.error("[market-warm] snapshot build failed:", (err as Error)?.message ?? err);
    return [];
  });
  const body = {
    cards: cards.length,
    mortgageRates: rates.value ? (rates.cached ? "cached" : "bought") : "unavailable",
    keyStats: keyStats ? { warmed: keyStats.warmed, fresh: keyStats.fresh.length, deferred: keyStats.deferred, failed: keyStats.failed } : "failed",
    ms: Date.now() - started,
  };
  console.log("[market-warm]", JSON.stringify(body));
  return Response.json(body, { status: cards.length > 0 ? 200 : 503 });
}
