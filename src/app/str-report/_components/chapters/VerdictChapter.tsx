import Link from "next/link";
import { C, gbp } from "../../_lib/brand";
import type { IncomeData, PropertyInput, RiskData, VerdictData } from "../../_lib/types";
import { StatTile } from "../ui/StatTile";
import { FaqSection } from "../FaqSection";

function presentationHref(input: PropertyInput): string {
  const params = new URLSearchParams({
    postcode: input.postcode,
    beds: String(input.beds),
    type: input.propertyType,
    mortgage: String(input.monthlyMortgage),
  });
  if (input.ownerName) params.set("name", input.ownerName);
  return `/str-report/presentation?${params.toString()}`;
}

const TYPE_LABEL: Record<PropertyInput["propertyType"], string> = {
  apartment: "apartment",
  terraced: "terraced house",
  "semi-detached": "semi-detached house",
  detached: "detached house",
};

function verdictColor(result: VerdictData["result"]): string {
  if (result === "borderline") return C.amber;
  if (result === "no") return C.gray400;
  return C.green;
}

function buildSummary(
  input: PropertyInput,
  income: IncomeData,
  risk: RiskData,
  verdict: VerdictData,
): string {
  const type = TYPE_LABEL[input.propertyType];
  const demand =
    risk.factors.find((f) => f.label === "Seasonality volatility")?.rating === "Low"
      ? "steady year-round demand"
      : "healthy demand with some seasonal swing";
  const reg = risk.factors.find((f) => f.label === "Local regulation")?.rating.toLowerCase() ?? "low";

  const opener = `A ${input.beds}-bed ${type} near ${input.postcode}`;

  if (verdict.result === "no") {
    return `${opener} doesn't make a compelling case for short letting. At a net of ${gbp(
      income.net,
    )}/mo the uplift over long let is too slim to justify the setup cost and management overhead, and the ${risk.overallRating.toLowerCase()} risk profile adds little incentive to switch.`;
  }
  if (verdict.result === "borderline") {
    return `${opener} sits on the fence. It shows ${demand} and ${reg} regulatory risk, but the ${verdict.upliftPct}% uplift over long let is marginal — it can work with sharp pricing and strong management, though the case isn't clear-cut.`;
  }
  return `${opener} has ${verdict.result === "strong-yes" ? "strong" : "solid"} STR fundamentals — ${demand}, a competitive ADR, and ${reg} regulatory risk. The ${verdict.upliftPct}% uplift over long let is enough to justify setup costs and management overhead. With professional management, this is a viable and profitable short let.`;
}

export function VerdictChapter({
  input,
  income,
  risk,
  verdict,
  onReset,
}: {
  input: PropertyInput;
  income: IncomeData;
  risk: RiskData;
  verdict: VerdictData;
  onReset: () => void;
}) {
  const color = verdictColor(verdict.result);

  return (
    <div className="sr-chapter-enter">
      <div style={{ marginBottom: 18 }}>
        <div className="sr-chapter-num" style={{ fontWeight: 500, color: C.gray300, lineHeight: 1 }}>
          05
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 500, color: C.gray900, margin: "6px 0 0" }}>The verdict</h2>
        <p style={{ fontSize: 15, color: C.gray500, lineHeight: 1.5, margin: "8px 0 0" }}>
          Based on your market, your numbers, and your risk profile — here&apos;s our answer.
        </p>
      </div>

      <div
        style={{
          border: `1px solid ${C.gray200}`,
          borderRadius: 12,
          padding: "1.75rem 1.5rem",
          textAlign: "center",
        }}
      >
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" style={{ display: "inline-block" }}>
          <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" />
          {verdict.result === "no" ? (
            <path d="M15 9l-6 6M9 9l6 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          ) : (
            <path d="M8 12.5l2.5 2.5L16 9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
        <h3 style={{ fontSize: 20, fontWeight: 500, color: C.gray900, margin: "12px 0 0" }}>{verdict.headline}</h3>
        <p style={{ fontSize: 14, color: C.gray500, lineHeight: 1.7, margin: "10px 0 0" }}>{verdict.summary}</p>
        <a
          href="https://calendly.com/stayful"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            marginTop: 18,
            background: color,
            color: C.white,
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 500,
            borderRadius: 8,
            padding: "12px 20px",
            minHeight: 44,
            boxSizing: "border-box",
          }}
        >
          Talk to Stayful about this property →
        </a>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 16 }}>
        <StatTile label="Estimated net/mo" value={gbp(income.net)} valueColor={C.green} />
        <StatTile label="Uplift vs long let" value={`${verdict.upliftPct >= 0 ? "+" : ""}${verdict.upliftPct}%`} />
        <StatTile label="Risk level" value={risk.overallRating} />
      </div>

      <div style={{ border: `1px solid ${C.gray200}`, borderRadius: 12, padding: "1rem 1.25rem", marginTop: 16 }}>
        <p style={{ fontSize: 14, color: C.gray800, lineHeight: 1.7, margin: 0 }}>
          {buildSummary(input, income, risk, verdict)}
        </p>
      </div>

      {/* Turn this report into a shareable, branded presentation. */}
      <Link
        href={presentationHref(input)}
        style={{
          display: "block",
          textAlign: "center",
          marginTop: 16,
          background: C.greenDk,
          color: C.white,
          textDecoration: "none",
          fontSize: 14,
          fontWeight: 500,
          borderRadius: 8,
          padding: "13px 20px",
        }}
      >
        View as presentation →
      </Link>

      <FaqSection />

      <div style={{ textAlign: "center", marginTop: 24 }}>
        <button
          type="button"
          onClick={onReset}
          style={{ background: "transparent", border: "none", color: C.gray500, fontSize: 13, cursor: "pointer" }}
        >
          ← Analyse a different property
        </button>
      </div>
    </div>
  );
}
