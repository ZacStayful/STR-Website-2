// Verdict engine.

import type { IncomeData, PropertyInput, RiskData, VerdictData, VerdictResult } from "./types";
import { ltlEstimate, paybackMonths, setupCost, upliftPct } from "./calculations";

export function buildVerdict(
  input: PropertyInput,
  income: IncomeData,
  risk: RiskData,
): VerdictData {
  const ltl = ltlEstimate(input.beds);
  const upliftAmount = income.net - ltl;
  const upliftPct_ = upliftPct(income.net, ltl);
  const setup = setupCost(input.beds);
  const payback = paybackMonths(setup, upliftAmount);

  let result: VerdictResult;
  if (upliftPct_ >= 30 && risk.overall <= 45) result = "strong-yes";
  else if (upliftPct_ >= 20 && risk.overall <= 60) result = "yes";
  else if (upliftPct_ >= 10) result = "borderline";
  else result = "no";

  const headlines: Record<VerdictResult, string> = {
    "strong-yes": "This property has strong STR potential",
    yes: "This property is worth short letting",
    borderline: "This property is borderline — proceed with caution",
    no: "STR is unlikely to be the right move here",
  };

  const summaries: Record<VerdictResult, string> = {
    "strong-yes": `Net income beats long let by ${upliftPct_}% with a ${risk.overallRating.toLowerCase()} risk profile. Setup costs recover in ${payback} months.`,
    yes: `Net income beats long let by ${upliftPct_}%, with a ${risk.overallRating.toLowerCase()} risk profile and setup payback in ${payback} months.`,
    borderline: `The ${upliftPct_}% uplift over long let is marginal. It may work with strong management and pricing, but the case isn't clear-cut.`,
    no: `The net income uplift over long let is less than 10%, which doesn't justify the additional complexity and setup cost of STR.`,
  };

  return {
    result,
    headline: headlines[result],
    summary: summaries[result],
    upliftPct: upliftPct_,
    upliftAmount,
    setupPaybackMonths: payback,
  };
}
