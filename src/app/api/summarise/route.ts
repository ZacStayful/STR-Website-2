import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AnalysisResult } from "@/lib/types";
import { isAdminEmail } from "@/lib/admin";
import { startAction } from "@/lib/credit/action";
import { runMetered } from "@/lib/credit/context";
import { estimateAction } from "@/lib/credit/estimate";
import { getUnitCostTable } from "@/lib/credit/unit-costs";
import { InsufficientCreditError } from "@/lib/credit/ledger";
import { insufficientCreditResponse } from "@/lib/credit/http";
import { meter, approxTokens } from "@/lib/credit/meter";
import { buildSystemPrompt, PERSONA_VERSION } from "@/lib/persona/stayful-intelligence";
import { cleanForSpeech } from "@/lib/persona/clean";
import { parseNarratorDeal, type NarratorDeal } from "@/lib/analysis/narrator-deal";

const NARRATOR_MODEL = "claude-opus-4-8";
const NARRATOR_MAX_TOKENS = 600;

// The model call is short (a ~120-word spoken summary at low effort), but give
// it more than the 10s Hobby default so it never gets cut off mid-stream.
export const maxDuration = 30;

// Batch 23, Part 0: the persona (src/lib/persona) gives who is speaking and how;
// this route adds only the task. The compact rendering keeps the prompt — and so
// the input tokens charged on every summary — about the size it was.
const SUMMARY_TASK = `Summarise this short-let analysis in 90–130 words. Open with the headline — does short-letting look strong, marginal or weak — and the key number. Give the one or two reasons that drive it. End with a practical next step about the process (check the comparables, book a viewing, ask the agent about permissions or service charge), never an instruction to buy or rent. Reply with the paragraph only.`;

const NARRATOR_SYSTEM = buildSystemPrompt("in_app_spoken", SUMMARY_TASK, { compact: true });

// Collapse the full AnalysisResult into a compact, model-friendly fact sheet.
// Keeping this deterministic (no prose) lets the model do the narration while we
// stay in control of which numbers it sees.
function buildFacts(r: AnalysisResult, deal: NarratorDeal | null = null): string {
  const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
  const p = r.property;
  const f = r.financials;
  const lines: string[] = [];

  lines.push(`PROPERTY: ${p.bedrooms}-bed property in ${p.address}, ${p.postcode}, sleeping ${p.guests}.`);
  if (deal) {
    const per = deal.period === "pcm" ? " a month" : deal.period === "pw" ? " a week" : "";
    const price = deal.amount !== undefined ? (deal.type === "purchase" ? `, asking ${gbp(deal.amount)}${per}` : `, rent ${gbp(deal.amount)}${per}`) : "";
    lines.push(`DEAL: ${deal.type === "purchase" ? "a purchase" : "a rent-to-rent"}${price}.`);
  }

  lines.push(`SHORT-LET: gross ${gbp(f.shortLetGrossAnnual)}/yr, net ${gbp(f.shortLetNetAnnual)}/yr.`);
  lines.push(`LONG-LET: gross ${gbp(f.longLetGrossAnnual)}/yr, net ${gbp(f.longLetNetAnnual)}/yr.`);
  lines.push(`DIFFERENCE (short minus long, net): ${gbp(f.annualDifference)}/yr (${gbp(f.monthlyDifference)}/mo).`);
  lines.push(`BREAK-EVEN OCCUPANCY: ${Math.round(f.breakEvenOccupancy * 100)}% (vs the analysis's projected occupancy).`); // stored 0–1

  const v = r.verdict;
  lines.push(`VERDICT FIT: ${v.fit}. RISK LEVEL: ${v.riskLevel}. OWNER INVOLVEMENT: ${v.ownerInvolvement}.`);
  if (v.recommendation) lines.push(`MODEL RECOMMENDATION TEXT: ${v.recommendation}`);

  lines.push(`RISK SCORE: ${r.risk.overallScore}/10. Seasonality: ${r.risk.seasonality}, income volatility: ${r.risk.incomeVolatility}, location demand: ${r.risk.locationDemand}, competition: ${r.risk.competition}, setup cost: ${r.risk.setupCost}.`);

  const d = r.demandDrivers;
  if (d) {
    const amenityCount =
      (d.hospitals?.length ?? 0) +
      (d.universities?.length ?? 0) +
      (d.airports?.length ?? 0) +
      (d.trainStations?.length ?? 0) +
      (d.busStations?.length ?? 0) +
      (d.subwayStations?.length ?? 0);
    const events = r.nearbyEvents?.totalEvents ?? 0;
    lines.push(`DEMAND DRIVERS: ${amenityCount} notable amenities/transport links nearby, ${events} upcoming events.`);
  }

  lines.push(`DATA QUALITY: ${r.dataQuality.level} (${r.dataQuality.comparablesFound}/${r.dataQuality.comparablesTarget} comparables, ${r.dataQuality.searchRadiusKm}km radius).`);
  if (r.crossValidation) {
    lines.push(`CROSS-VALIDATION CONFIDENCE: ${r.crossValidation.confidence}.`);
  }
  if (r.propertyValuation) {
    lines.push(`ESTIMATED SALE VALUE: ${gbp(r.propertyValuation.estimatedValue)}.`);
  }

  return lines.join("\n");
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "The AI narrator isn't configured yet (missing ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  // /estimate is already auth-gated by middleware, but never run the model for
  // an unauthenticated request that reaches the API directly.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "You need to sign in to use the narrator." }, { status: 401 });
  }

  let result: AnalysisResult;
  let deal: NarratorDeal | null = null;
  try {
    const body = (await request.json()) as { result?: AnalysisResult; deal?: unknown };
    result = body.result as AnalysisResult;
    deal = parseNarratorDeal(body.deal);
    if (!result?.property || !result?.financials || !result?.verdict) {
      throw new Error("missing fields");
    }
  } catch {
    return Response.json({ error: "Invalid analysis payload." }, { status: 400 });
  }

  // Batch 21 (G16): the SDK's default is a 10-minute timeout with retries, on a 30 s route;
  // a slow call must fail inside the route so the credit reservation is released, not held to its TTL.
  const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 0 });
  const facts = buildFacts(result, deal);

  // Credit: reserve the ceiling (prompt tokens + max_tokens of output), then
  // charge the actual token usage the API reports.
  const inputTokens = approxTokens(NARRATOR_SYSTEM + facts) + 50;
  const estimate = estimateAction(await getUnitCostTable(), "narrate", { inputTokens, maxOutputTokens: NARRATOR_MAX_TOKENS });
  let action;
  try {
    action = await startAction({ userId: user.id, admin: isAdminEmail(user.email), action: "narrate", maxBasePence: estimate.maxBasePence });
  } catch (err) {
    if (err instanceof InsufficientCreditError) return insufficientCreditResponse(err, "narrate");
    throw err;
  }

  try {
    const message = await runMetered(action.ctx, async () => {
      const msg = await meter(
        { provider: "anthropic", unit: "output_token", quantityFrom: (m: Anthropic.Message) => m.usage.output_tokens, description: "AI narration (output tokens)" },
        () =>
          client.messages.create({
            model: NARRATOR_MODEL,
            max_tokens: NARRATOR_MAX_TOKENS,
            // Low effort + a tight system prompt keeps this fast and cheap — it's a
            // narration task, not a reasoning one.
            output_config: { effort: "low" },
            system: NARRATOR_SYSTEM,
            messages: [{ role: "user", content: facts }],
          }),
      );
      // Input side of the same call, priced from the usage the API returned.
      await meter({ provider: "anthropic", unit: "input_token", quantity: msg.usage.input_tokens, description: "AI narration (input tokens)", skipPreflight: true }, async () => msg);
      const cacheRead = msg.usage.cache_read_input_tokens ?? 0;
      if (cacheRead > 0) await meter({ provider: "anthropic", unit: "cache_read_token", quantity: cacheRead, skipPreflight: true }, async () => msg);
      const cacheWrite = msg.usage.cache_creation_input_tokens ?? 0;
      if (cacheWrite > 0) await meter({ provider: "anthropic", unit: "cache_write_token", quantity: cacheWrite, skipPreflight: true }, async () => msg);
      return msg;
    });

    // Strip any markdown or emoji the model adds anyway: the text is read aloud.
    const summary = cleanForSpeech(
      message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join(""),
    );

    if (!summary) {
      return Response.json({ error: "The narrator returned an empty summary." }, { status: 502 });
    }

    console.log(`[api/summarise] persona ${PERSONA_VERSION}, input tokens ${message.usage.input_tokens}`);
    return Response.json({ summary }, { headers: { "x-si-persona": PERSONA_VERSION } });
  } catch (err) {
    console.error("[api/summarise] generation failed:", err);
    return Response.json(
      { error: "Could not generate a summary right now. Please try again." },
      { status: 502 },
    );
  } finally {
    await action.finish().catch(() => {});
  }
}
