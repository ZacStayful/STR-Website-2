import type { AreaScore } from "@/lib/market/score";

/**
 * The "show our working" panel — every sub-score with the raw value behind it
 * and the points earned out of its weight. This is the deliberate transparency
 * differentiator vs an opaque single number.
 */
export function ScoreBreakdown({ score }: { score: AreaScore }) {
  return (
    <div className="mx-panel">
      <h2>Stayful score: {score.score}/100 · {score.grade} ({score.gradeLabel})</h2>
      <p style={{ color: "var(--mx-muted)" }}>
        A transparent composite of four factors — we show our working. Higher is better.
        {score.partial && " This score is partial: no area property-value data, so yield-on-cost is excluded and the other factors are reweighted."}
      </p>
      <table className="mx-table">
        <thead>
          <tr><th>Factor</th><th>What it measures</th><th>Points</th></tr>
        </thead>
        <tbody>
          {score.components.map((c) => (
            <tr key={c.key}>
              <td>{c.label}</td>
              <td style={{ textAlign: "left", color: "var(--mx-muted)" }}>{c.detail}</td>
              <td>
                {c.earned === null ? (
                  <span style={{ color: "var(--mx-muted)" }}>excluded</span>
                ) : (
                  <>
                    <strong>{Math.round(c.earned * 10) / 10}</strong>
                    <span style={{ color: "var(--mx-muted)" }}> / {c.weight}</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
