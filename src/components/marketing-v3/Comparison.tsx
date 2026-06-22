import { Icon } from "@/lib/icons";
import type { CSSProperties } from "react";

type CellValue = boolean | string;

const COLS: { name: string; hl?: boolean }[] = [
  { name: "The Stayful Analyser", hl: true },
  { name: "Property Market Intel" },
];

const ROWS: { l: string; v: CellValue[] }[] = [
  { l: "Long-let vs short-let comparison", v: [true, false] },
  { l: "Live Airbnb comparables", v: [true, false] },
  { l: "Average review rating & reviews", v: [true, false] },
  { l: "12-month forecast", v: [true, false] },
  { l: "Direct booking opportunity potential", v: [true, false] },
  { l: "Risk profile", v: [true, false] },
  { l: "Advised & essential amenities", v: [true, false] },
  { l: "Estimated property setup costs", v: [true, false] },
  { l: "Download PDF report", v: [true, true] },
  { l: "Estimate true profit potential", v: [true, false] },
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
          <h3>Every signal that moves the number — in one report</h3>
          <ul className="ce-list">
            {ROWS.map((r, i) => (
              <li key={i}>
                <span className="ce-tick">
                  <Icon name="check" size={13} stroke={2.5} />
                </span>
                {r.l}
              </li>
            ))}
          </ul>
          <p className="lede">
            Each of these measures a different lever on real-world property
            performance. Live Airbnb comparables and average review ratings show
            you the demand and quality you&rsquo;d be competing against. The
            12-month forecast, direct booking opportunity and true profit
            potential show the upside. Estimated setup costs and the advised
            &amp; essential amenities show what it actually takes to get there.
            The risk profile and the long-let vs short-let comparison show the
            downside, so you go in with your eyes open. On its own, any one of
            these is just a data point. Stayful pulls every one of them into a
            single, visual decision engine — so instead of stitching together
            spreadsheets and market reports, you see at a glance whether a
            property is worth pursuing, what it would take to win, and exactly
            what you&rsquo;d walk away with.
          </p>
        </div>
      </div>
    </section>
  );
}
