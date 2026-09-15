import { Icon } from "@/lib/icons";
import type { CSSProperties } from "react";

type CellValue = boolean | string;

const COLS: { name: string; hl?: boolean }[] = [
  { name: "The Stayful Analyser", hl: true },
  { name: "Property Market Intel" },
  { name: "AirDNA" },
  { name: "PriceLabs" },
];

const ROWS: { l: string; v: CellValue[]; d: string; prov?: boolean }[] = [
  {
    l: "Real booking data from properties the vendor operates",
    v: [true, false, false, false],
    prov: true,
    d: "Every other tool here infers performance from listings it can see from the outside. We also take the bookings — on our own P&L, for owners who hold us to the number. That is a different kind of data, and it is the only kind that can tell you whether a model was wrong.",
  },
  {
    l: "Forecast vs actual published, property by property",
    v: [true, false, false, false],
    prov: true,
    d: "Modelled figures are easy to publish and impossible to check. We publish the estimate we gave before a property went live, next to what it did over the following twelve months, with the property named and the PDF attached.",
  },
  {
    l: "Live Airbnb comparables",
    v: [true, true, true, true],
    d: "Real, active listings near your postcode — not national averages — so your numbers reflect the market you'd genuinely compete in.",
  },
  {
    l: "Long-let vs short-let comparison",
    v: [true, false, false, false],
    d: "See both income models side by side, so you know which strategy actually wins for this exact property before you commit.",
  },
  {
    l: "Average review rating & reviews",
    v: [true, false, false, false],
    d: "Gauge how guests rate nearby properties so you know the quality bar you'll need to clear to win bookings and command higher rates.",
  },
  {
    l: "12-month forecast",
    v: [true, true, true, true],
    d: "Month-by-month projected income that builds in seasonality, so you can plan cashflow with confidence instead of guessing.",
  },
  {
    l: "Direct booking opportunity potential",
    v: [true, false, false, false],
    d: "See how much income you could keep by driving direct bookings and cutting platform fees out of your margin.",
  },
  {
    l: "Risk profile",
    v: [true, false, true, false],
    d: "A clear read on regulation, demand volatility and operating risk, so there are no nasty surprises after you've bought.",
  },
  {
    l: "Advised & essential amenities",
    v: [true, false, true, false],
    d: "Know exactly what the property needs to perform — the must-haves and the upgrades that lift your nightly rate.",
  },
  {
    l: "Estimated property setup costs",
    v: [true, true, false, false],
    d: "An itemised view of what it costs to furnish and go live, so your return is built on the full picture, not a guess.",
  },
  {
    l: "Download PDF report",
    v: [true, true, false, true],
    d: "Take the whole analysis with you — share it with partners, lenders or your team in one clean, professional document.",
  },
  {
    l: "Estimate true profit potential",
    v: [true, true, false, false],
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
            Every other platform is guessing
            <br />
            from the outside.
          </h2>
          <p className="lede">
            Comparables tell you what listings near a postcode appear to earn.
            That is a reasonable guess, and it is all most of this category
            has. We start from the same market data, then check it against
            properties we manage and take bookings for ourselves — which is
            why the first two rows below are the ones that matter.
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
            <div
              key={ri}
              className={
                "ct-row" +
                (r.prov && !ROWS[ri + 1]?.prov ? " ct-row--provenance" : "")
              }
            >
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
