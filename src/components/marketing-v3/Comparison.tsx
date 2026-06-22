import { Icon } from "@/lib/icons";
import type { CSSProperties } from "react";

type CellValue = boolean | string;

const COLS: { name: string; hl?: boolean }[] = [
  { name: "The Stayful Analyser", hl: true },
  { name: "Property Market Intel" },
];

const ROWS: { l: string; v: CellValue[]; d: string }[] = [
  {
    l: "Long-let vs short-let comparison",
    v: [true, false],
    d: "See both income models side by side, so you know which strategy actually wins for this exact property before you commit.",
  },
  {
    l: "Live Airbnb comparables",
    v: [true, false],
    d: "Real, active listings near your postcode — not national averages — so your numbers reflect the market you'd genuinely compete in.",
  },
  {
    l: "Average review rating & reviews",
    v: [true, false],
    d: "Gauge how guests rate nearby properties so you know the quality bar you'll need to clear to win bookings and command higher rates.",
  },
  {
    l: "12-month forecast",
    v: [true, false],
    d: "Month-by-month projected income that builds in seasonality, so you can plan cashflow with confidence instead of guessing.",
  },
  {
    l: "Direct booking opportunity potential",
    v: [true, false],
    d: "See how much income you could keep by driving direct bookings and cutting platform fees out of your margin.",
  },
  {
    l: "Risk profile",
    v: [true, false],
    d: "A clear read on regulation, demand volatility and operating risk, so there are no nasty surprises after you've bought.",
  },
  {
    l: "Advised & essential amenities",
    v: [true, false],
    d: "Know exactly what the property needs to perform — the must-haves and the upgrades that lift your nightly rate.",
  },
  {
    l: "Estimated property setup costs",
    v: [true, false],
    d: "An itemised view of what it costs to furnish and go live, so your return is built on the full picture, not a guess.",
  },
  {
    l: "Download PDF report",
    v: [true, true],
    d: "Take the whole analysis with you — share it with partners, lenders or your team in one clean, professional document.",
  },
  {
    l: "Estimate true profit potential",
    v: [true, false],
    d: "Net profit after costs and fees, not headline revenue — the number that actually tells you whether a deal is worth doing.",
  },
];

export function Comparison() {
  return (
    <section className="compare section" id="compare">
      <div className="wrap-narrow">
        <div className="compare-head">
          <div className="eyebrow">Why it&rsquo;s different</div>
          <h2>
            Most tools tell you what an area earns.
            <br />
            Stayful tells you what to do.
          </h2>
          <p className="lede">
            A decision engine, not a calculator. Compare the inputs and outputs
            side by side.
          </p>
        </div>
        <div
          className="compare-table"
          style={{ "--ct-cols": COLS.length } as CSSProperties}
        >
          <div className="ct-row ct-head">
            <div className="ct-cell ct-feature">Feature</div>
            {COLS.map((c, i) => (
              <div key={i} className={"ct-cell" + (c.hl ? " hl" : "")}>
                {c.name}
              </div>
            ))}
          </div>
          {ROWS.map((r, ri) => (
            <div key={ri} className="ct-row">
              <div className="ct-cell ct-feature">{r.l}</div>
              {r.v.map((val, vi) => (
                <div
                  key={vi}
                  className={"ct-cell" + (COLS[vi].hl ? " hl" : "")}
                >
                  {val === true ? (
                    <span className="ct-yes">
                      <Icon name="check" size={14} stroke={2.5} />
                    </span>
                  ) : val === false ? (
                    <span className="ct-no">
                      <Icon name="minus" size={14} />
                    </span>
                  ) : (
                    <span className="ct-text">{val}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="compare-explainer">
          <div className="ce-head">
            <h3>Every signal that moves the number — in one report</h3>
            <p className="lede">
              Each feature measures a different lever on real-world property
              performance. On its own, any one is just a data point — together,
              they form a single visual decision engine that tells you whether a
              property is worth pursuing, what it would take to win, and exactly
              what you&rsquo;d walk away with.
            </p>
          </div>
          <div className="ce-grid">
            {ROWS.map((r, i) => (
              <div key={i} className="ce-item">
                <h4>
                  <span className="ce-tick">
                    <Icon name="check" size={13} stroke={2.5} />
                  </span>
                  {r.l}
                </h4>
                <p>{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
