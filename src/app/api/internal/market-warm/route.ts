import { getAreaCards } from "@/lib/market/cached";
import { ask, pdMortgageRates } from "@/lib/broker";
import { planAllRegionKeyStats, warmAllRegionKeyStats } from "@/lib/market/key-stats-cache";
import { getUnitCostTable } from "@/lib/credit/unit-costs";
import { unitKey } from "@/lib/credit/costs";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Market snapshot warm-up ────────────────────────────────────────
// Vercel cron (vercel.json), 04:45 UTC: buys the shared PropertyData answers
// (the national mortgage averages and, a few regions a day, the region key
// stats) as house spend, then builds the hourly-cached market snapshot
// (`getAreaCards`) so the daily picks passes at 07:00 / 07:20 / 07:40 find
// it ready instead of spending their own budget on it. Harmless when the
// cache is warm. MARKET_WARM_ENABLED=false switches it off (key stats then
// go stale after their month; members' reports never buy them).
//
//   ?dry=1   say what it would buy and roughly what that costs; buys nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/market-warm?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

function marketWarmEnabled(): boolean {
  return process.env.MARKET_WARM_ENABLED !== "false";
}

async function dryRun(enabled: boolean): Promise<Response> {
  const [rates, keyStats, table] = await Promise.all([ask(pdMortgageRates, {}, { mode: "cron", cacheOnly: true }), planAllRegionKeyStats(), getUnitCostTable()]);
  const pence = (unit: string) => table.get(unitKey("propertydata", unit))?.unitCostPence ?? 0;
  const buyRates = !rates.value || rates.stale;
  const costPence = (buyRates ? pence("mortgage_rates") : 0) + keyStats.wouldBuy.length * pence("postcode_key_stats");
  const body = {
    dry: true,
    enabled,
    mortgageRates: buyRates ? "would buy (1 credit)" : "cached, fresh",
    keyStats: { wouldBuy: keyStats.wouldBuy, fresh: keyStats.fresh.length, deferred: keyStats.deferred },
    estimatedCostPence: Math.round(costPence * 10) / 10,
    snapshot: "built from the hourly cache; a cold build looks up long-let rents for areas whose cached rent has expired (at most area_rent_daily_attempts a day)",
  };
  return Response.json(body);
}

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const enabled = marketWarmEnabled();
  if (new URL(request.url).searchParams.get("dry") === "1") return dryRun(enabled);
  if (!enabled) return Response.json({ enabled: false, reason: "MARKET_WARM_ENABLED is 'false'" });
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
