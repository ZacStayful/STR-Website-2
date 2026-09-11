import Link from "next/link";
import type { SampleArea as SampleAreaData } from "@/lib/market/explorer";
import { Icon } from "@/lib/icons";
import { AreaCard } from "../AreaCard";
import { ScoreBreakdown } from "../ScoreBreakdown";

/**
 * The one place on the public page where real figures appear: a single area,
 * rendered with the real card and score breakdown as a taster. Links go to
 * signup (returning to the explorer), never to other areas.
 */
export function SampleArea({ sample }: { sample: SampleAreaData }) {
  const { card, totalAreas } = sample;
  const signup = `/signup?next=${encodeURIComponent(`/markets/${card.slug}`)}`;
  return (
    <section className="section-tight mxp-sample-section" id="sample">
      <div className="wrap-narrow">
        <div className="mxp-sample-head">
          <div className="eyebrow">A live taster</div>
          <h2>This is {card.name}, today.</h2>
          <p className="lede">
            One of {totalAreas} areas in the explorer right now, exactly as members see it:
            real averages from {card.headline.totalSamples} analyser reports, the transparent
            score and how it was earned. Every other area unlocks with your free trial.
          </p>
        </div>
        <div className="mx mxp-sample">
          <div className="mxp-sample-grid">
            <AreaCard card={card} href={signup} />
            <ScoreBreakdown score={card.score!} />
          </div>
        </div>
        <div className="mxp-sample-cta">
          <Link href={signup} className="btn btn-primary">
            Unlock all {totalAreas} areas <Icon name="arrow" size={14} />
          </Link>
          <span className="muted">Free trial · No card required</span>
        </div>
      </div>
    </section>
  );
}
