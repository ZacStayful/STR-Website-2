"use client";

import type { AreaScore } from "@/lib/market/score";
import type { PersonalScore } from "@/lib/market/personalise";
import { ScoreRing } from "../shared/ScoreRing";
import { Tag } from "../shared/Tag";
import { Kv, Working } from "../../VerdictBits";

function points(earned: number | null, weight: number): string {
  return earned === null ? "excluded" : `${Math.round(earned * 10) / 10} / ${Math.round(weight * 10) / 10}`;
}

/** "How is this market performing?": the two rings and the four score components as bars. */
export function PerformanceCard({ score, personal, hasGoals, onSetGoals }: { score: AreaScore | null; personal: PersonalScore | null; hasGoals: boolean; onSetGoals: () => void }) {
  return (
    <div className="mx2-card mx2-perf">
      <h4 className="mx2-h4">How is this market performing?</h4>
      <div className="mx2-perf-body">
        <div className="mx2-perf-rings">
          <div className="mx2-perf-ring">
            <ScoreRing value={score?.score ?? null} size={96} label={score ? `Market score ${score.score} out of 100, ${score.gradeLabel}` : "Market score not yet available"} />
            <span>Market score</span>
            {score?.partial && <Tag tone="neutral" title="No property-value data, so the yield component is excluded and the rest renormalised">partial</Tag>}
          </div>
          <div className="mx2-perf-ring">
            <ScoreRing
              value={personal?.score ?? null}
              size={96}
              colour="var(--mx-ink)"
              label={personal ? `Your fit ${personal.score} out of 100, ${personal.gradeLabel}` : "Your fit needs goals"}
              empty={hasGoals ? "—" : <button type="button" onClick={onSetGoals}>Set goals</button>}
            />
            <span>Your fit</span>
          </div>
        </div>
        <div className="mx2-perf-bars">
          {score ? (
            score.components.map((k) => (
              <div key={k.key} className="mx2-bar" title={k.detail}>
                <div className="mx2-bar-head"><span>{k.label}</span><b>{points(k.earned, k.weight)}</b></div>
                <div className="mx2-bar-track"><div className="mx2-bar-fill" style={{ width: k.earned === null ? 0 : `${(k.earned / k.weight) * 100}%` }} /></div>
              </div>
            ))
          ) : (
            <p className="mx2-note">Needs revenue or occupancy data before a score is shown. As reports come in for this area the score appears automatically.</p>
          )}
        </div>
      </div>
      <p className="mx2-note">
        Market score = yield-on-cost (40) + occupancy (25) + revenue scale (20) + regulatory ease (15), renormalised when a component is missing. Your fit re-weights the same inputs by your goals.
      </p>
      {personal && (
        <Working title={`Your fit ${personal.score} · ${personal.grade}`} small="the market score re-weighted by your goals">
          <Kv rows={personal.components.map((k) => ({ k: k.label, v: points(k.earned, k.weight) }))} />
          <p className="mx-muted-p">{personal.components.map((k) => k.detail).join(" · ")}</p>
        </Working>
      )}
    </div>
  );
}
