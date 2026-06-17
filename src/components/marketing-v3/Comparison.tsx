import { Icon } from "@/lib/icons";

type CellValue = boolean | string;

const COLS: { name: string; hl?: boolean }[] = [
  { name: "The Stayful Analyser", hl: true },
  { name: "A spreadsheet" },
  { name: "AirDNA-style tools" },
  { name: "Asking a friend" },
];

const ROWS: { l: string; v: CellValue[] }[] = [
  { l: "Live Airbnb comparables for your postcode", v: [true, false, true, false] },
  { l: "Long-let valuation comps", v: [true, false, false, false] },
  { l: "Council regulation tracker", v: [true, false, false, false] },
  { l: "Itemised setup cost quote", v: [true, "Manual", false, false] },
  { l: "12-month seasonal forecast", v: [true, "Manual", true, false] },
  { l: "Risk assessment", v: [true, false, false, "Vibes"] },
  { l: "Ranked growth playbook", v: [true, false, false, false] },
  { l: "Decision-ready in 20 seconds", v: [true, false, "Partial", "Eventually"] },
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
        <div className="compare-table">
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
      </div>
    </section>
  );
}
