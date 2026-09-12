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

const NARRATOR_MODEL = "claude-opus-4-8";
const NARRATOR_MAX_TOKENS = 600;

// The model call is short (a ~120-word spoken summary at low effort), but give
// it more than the 10s Hobby default so it never gets cut off mid-stream.
export const maxDuration = 30;

const NARRATOR_SYSTEM = `You are Stayful's analyst — the voice of the Stayful property analyser. You speak directly to a UK landlord who has just run a short-let income analysis on their property, and your job is to summarise the result and help them decide whether short-letting it makes sense.

Rules:
- Write ONE spoken-aloud paragraph, 90–130 words. No headings, no bullet points, no markdown, no emoji — it will be read by a text-to-speech voice.
- Open with the headline: is short-letting clearly worth it, marginal, or not worth it for this property, and the key number (the net annual or monthly difference vs long-let).
- Then give the one or two reasons that drive the verdict (demand, seasonality, occupancy needed to break even, setup/involvement, data confidence).
- End with a clear, honest recommendation framed as a next step.
- Never guarantee income. Say "comparable properties typically achieve" or "the analysis estimates". Use £ and round figures naturally for speech (e.g. "about £8,400 more a year", not "£8,432.17").
- Be warm, direct and concise — a trusted advisor, not a salesperson. Respond with only the paragraph itself, nothing else.`;

// Collapse the full AnalysisResult into a compact, model-friendly fact sheet.
// Keeping this deterministic (no prose) lets the model do the narration while we
// stay in control of which numbers it sees.
function buildFacts(r: AnalysisResult): string {
  const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
  const p = r.property;
  const f = r.financials;
  const lines: string[] = [];

  lines.push(`PROPERTY: ${p.bedrooms}-bed property in ${p.address}, ${p.postcode}, sleeping ${p.guests}.`);

  lines.push(`SHORT-LET: gross ${gbp(f.shortLetGrossAnnual)}/yr, net ${gbp(f.shortLetNetAnnual)}/yr.`);
  lines.push(`LONG-LET: gross ${gbp(f.longLetGrossAnnual)}/yr, net ${gbp(f.longLetNetAnnual)}/yr.`);
  lines.push(`DIFFERENCE (short minus long, net): ${gbp(f.annualDifference)}/yr (${gbp(f.monthlyDifference)}/mo).`);
  lines.push(`BREAK-EVEN OCCUPANCY: ${Math.round(f.breakEvenOccupancy)}% (vs the analysis's projected occupancy).`);

  const v = r.verdict;
  lines.push(`VERDICT FIT: ${v.fit}. RISK LEVEL: ${v.riskLevel}. OWNER INVOLVEMENT: ${v.ownerInvolvement}.`);
  if (v.recommendation) lines.push(`MODEL RECOMMENDATION TEXT: ${v.recommendation}`);

  lines.push(`RISK SCORE: ${r.risk.overallScore}/100. Seasonality: ${r.risk.seasonality}, income volatility: ${r.risk.incomeVolatility}, location demand: ${r.risk.locationDemand}, competition: ${r.risk.competition}, setup cost: ${r.risk.setupCost}.`);

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
  try {
    const body = (await request.json()) as { result?: AnalysisResult };
    result = body.result as AnalysisResult;
    if (!result?.property || !result?.financials || !result?.verdict) {
      throw new Error("missing fields");
    }
  } catch {
    return Response.json({ error: "Invalid analysis payload." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });
  const facts = buildFacts(result);

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

    const summary = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!summary) {
      return Response.json({ error: "The narrator returned an empty summary." }, { status: 502 });
    }

    return Response.json({ summary });
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
