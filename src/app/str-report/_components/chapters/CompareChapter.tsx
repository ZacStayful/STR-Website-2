import { C, gbp } from "../../_lib/brand";
import type { VerdictData } from "../../_lib/types";
import { ChapterHeader } from "../ui/ChapterHeader";

const cardStyle: React.CSSProperties = {
  border: `1px solid ${C.gray200}`,
  borderRadius: 12,
  padding: "1rem 1.25rem",
  marginTop: 16,
};

export function CompareChapter({
  strNet,
  ltlNet,
  setupCostValue,
  verdict,
}: {
  strNet: number;
  ltlNet: number;
  setupCostValue: number;
  verdict: VerdictData;
}) {
  const pct = verdict.upliftPct;
  const monthlyDiff = verdict.upliftAmount;
  const annualDiff = monthlyDiff * 12;

  let testColor: string = C.green;
  let testSentence = `Your property passes this test at +${pct}%.`;
  if (pct < 10) {
    testColor = C.red;
    testSentence = `The margin is too thin at +${pct}% to recommend STR.`;
  } else if (pct < 20) {
    testColor = C.amber;
    testSentence = `Your property is borderline at +${pct}% — worth reviewing further.`;
  }

  return (
    <div className="sr-chapter-enter">
      <ChapterHeader
        number="03"
        title="STR vs long let"
        subtitle="The question every landlord actually asks. Here's the honest, unvarnished comparison."
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
        <div style={{ border: `1px solid ${C.gray200}`, borderRadius: 12, padding: "0.9rem 1rem" }}>
          <div style={{ fontSize: 12, color: C.gray500 }}>Long let — estimated net</div>
          <div style={{ fontSize: 24, fontWeight: 500, color: C.gray400, marginTop: 6 }}>{gbp(ltlNet)}</div>
          <div style={{ fontSize: 11, color: C.gray400, marginTop: 4 }}>per month · low effort</div>
        </div>
        <div style={{ border: `2px solid ${C.green}`, borderRadius: 12, padding: "0.9rem 1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: C.gray500 }}>Short let — estimated net</span>
            <span
              style={{
                background: C.greenLt,
                color: C.greenTx,
                fontSize: 10,
                fontWeight: 500,
                padding: "1px 6px",
                borderRadius: 999,
              }}
            >
              Recommended
            </span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 500, color: C.green, marginTop: 6 }}>{gbp(strNet)}</div>
          <div style={{ fontSize: 11, color: C.gray400, marginTop: 4 }}>per month · managed</div>
        </div>
      </div>

      <div style={{ ...cardStyle, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: C.gray500 }}>Potential uplift vs long let</div>
        <div style={{ fontSize: 28, fontWeight: 500, color: C.green, margin: "4px 0" }}>
          {monthlyDiff >= 0 ? "+" : "−"}
          {gbp(Math.abs(monthlyDiff))}/mo
        </div>
        <div style={{ fontSize: 12, color: C.gray500 }}>
          {pct >= 0 ? "+" : ""}
          {pct}% more per month · {annualDiff >= 0 ? "+" : "−"}
          {gbp(Math.abs(annualDiff))} per year
        </div>
      </div>

      <div style={cardStyle}>
        <p style={{ fontSize: 14, color: C.gray800, lineHeight: 1.7, margin: 0 }}>
          For STR to justify the additional management complexity, net income needs to beat long let by
          at least <strong style={{ fontWeight: 500 }}>20%</strong>.{" "}
          <span style={{ color: testColor, fontWeight: 500 }}>{testSentence}</span>
        </p>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800 }}>Setup cost payback</div>
        <p style={{ fontSize: 14, color: C.gray500, lineHeight: 1.7, margin: "6px 0 0" }}>
          Estimated furnishing &amp; setup: <strong style={{ fontWeight: 500, color: C.gray800 }}>{gbp(setupCostValue)}</strong>
          <br />
          Paid back in{" "}
          <strong style={{ fontWeight: 500, color: C.gray800 }}>
            {verdict.setupPaybackMonths >= 999 ? "—" : `${verdict.setupPaybackMonths} months`}
          </strong>{" "}
          from the uplift alone
        </p>
      </div>
    </div>
  );
}
