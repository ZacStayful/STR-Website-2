import type { AreaScore } from "@/lib/market/score";

/**
 * Transparent area score as a sage ring with the number + grade letter.
 * The ring fill is proportional to the score so it reads at a glance; the
 * full breakdown ("show our working") lives on the area page.
 */
export function ScoreBadge({ score, size = 56 }: { score: AreaScore; size?: number }) {
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const dash = (score.score / 100) * circ;

  return (
    <div className="mx-score" title={`Stayful score ${score.score}/100 (${score.gradeLabel})${score.partial ? " — partial (no yield data)" : ""}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#fff"
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="mx-score-inner">
        <span className="mx-score-num">{score.score}</span>
        <span className="mx-score-grade">{score.grade}{score.partial ? "*" : ""}</span>
      </div>
    </div>
  );
}
