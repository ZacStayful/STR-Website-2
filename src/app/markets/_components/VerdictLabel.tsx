import { TrendingUp, TrendingDown, Minus, HelpCircle } from "lucide-react";
import type { AreaVerdict } from "@/lib/market/verdict";
import { gbp } from "@/lib/market/format";

/**
 * The long-let vs short-let verdict, area level. Degrades to a plain
 * "verdict unavailable" when there's no long-let comparator (verdict === null).
 */
export function VerdictLabel({ verdict, compact = false }: { verdict: AreaVerdict | null; compact?: boolean }) {
  if (!verdict) {
    return (
      <span className="mx-verdict mx-verdict--na">
        <HelpCircle aria-hidden /> Short vs long-let: not enough data
      </span>
    );
  }

  if (verdict.winner === "short-let") {
    return (
      <span className="mx-verdict mx-verdict--short">
        <TrendingUp aria-hidden />
        Short-let wins{compact ? "" : ` by ${gbp(verdict.annualAdvantage)}/yr`}
      </span>
    );
  }
  if (verdict.winner === "long-let") {
    return (
      <span className="mx-verdict mx-verdict--long">
        <TrendingDown aria-hidden />
        Long-let wins{compact ? "" : ` by ${gbp(verdict.annualAdvantage)}/yr`}
      </span>
    );
  }
  return (
    <span className="mx-verdict mx-verdict--tossup">
      <Minus aria-hidden /> Line-ball: short vs long-let
    </span>
  );
}
