import type { Confidence } from "@/lib/market/confidence";

/**
 * Data-confidence chip: shows the tier (Confirmed / Building / Early) and the
 * exact sample count, so it's always clear how much data an area's figures rest
 * on. Colour: sage = confirmed, amber = building, grey = early.
 */
export function ConfidenceBadge({
  confidence,
  samples,
  showBlurb = false,
}: {
  confidence: Confidence;
  samples: number;
  showBlurb?: boolean;
}) {
  return (
    <span className={`mx-conf mx-conf--${confidence.tier}`}>
      <span className="mx-conf-dot" aria-hidden />
      <span className="mx-conf-label">{confidence.label}</span>
      <span className="mx-conf-count">· {samples} {samples === 1 ? "sample" : "samples"}</span>
      {showBlurb && <span className="mx-conf-blurb">{confidence.blurb}</span>}
    </span>
  );
}
