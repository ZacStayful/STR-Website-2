import { Icon } from "@/lib/icons";
import { ProductMapVisual } from "./ProductMapVisual";

/**
 * Illustrative mock-ups for the public product page. Every number here is
 * placeholder copy (blurred or clearly labelled "Illustrative") — none of it
 * is real Market Explorer output. The real figures only ever render for
 * signed-in members and the single sample area.
 */

const ROWS = [
  { rank: 1, name: "Harrogate", code: "HG", grade: "A", w: 82 },
  { rank: 2, name: "York", code: "YO", grade: "A", w: 78 },
  { rank: 3, name: "Bristol", code: "BS", grade: "B", w: 71 },
  { rank: 4, name: "Manchester", code: "M", grade: "B", w: 66 },
  { rank: 5, name: "Nottingham", code: "NG", grade: "C", w: 58 },
  { rank: 6, name: "Newcastle", code: "NE", grade: "C", w: 54 },
];

function Blur({ w = 48 }: { w?: number }) {
  return <span className="mxp-blur" style={{ width: w }} aria-hidden />;
}

export function MockRankedList({ rows = 6, dense = false }: { rows?: number; dense?: boolean }) {
  return (
    <div className={"mxp-list" + (dense ? " dense" : "")}>
      <div className="mxp-list-head">
        <span>Area</span>
        <span>Score</span>
        <span>Revenue</span>
        <span>Yield</span>
      </div>
      {ROWS.slice(0, rows).map((r) => (
        <div key={r.code} className="mxp-row">
          <span className="mxp-row-name">
            <span className="mxp-row-rank">{r.rank}</span>
            {r.name} <em>{r.code}</em>
          </span>
          <span className="mxp-row-score">
            <span className="mxp-ring" style={{ ["--w" as string]: `${r.w}%` }}>
              <b>{r.grade}</b>
            </span>
          </span>
          <span><Blur w={44} /></span>
          <span><Blur w={36} /></span>
        </div>
      ))}
      <div className="mxp-list-lock">
        <Icon name="shield" size={13} /> Figures unlock with your free trial
      </div>
    </div>
  );
}

export function MockGoalChips() {
  return (
    <div className="mxp-chips" aria-hidden>
      <span className="mxp-chip"><Icon name="pin" size={12} /> Within 50 miles of NG2</span>
      <span className="mxp-chip"><Icon name="bed" size={12} /> 2-bed</span>
      <span className="mxp-chip">£200k–£350k</span>
      <span className="mxp-chip on"><Icon name="target" size={12} /> Max yield</span>
      <span className="mxp-chip">Low competition</span>
    </div>
  );
}

export function MockMapPane({ compact = false }: { compact?: boolean }) {
  return (
    <div className={"mxp-mappane" + (compact ? " compact" : "")}>
      <ProductMapVisual highlight={["HG", "YO"]} compact={compact} />
      <div className="mxp-map-legend">
        <span>Illustrative shading</span>
        <i className="mxp-legend-bar" />
        <span>Stronger</span>
      </div>
    </div>
  );
}

export function MockScoreTable() {
  const rows = [
    { f: "Yield-on-cost", d: "Revenue ÷ property value", pts: 40 },
    { f: "Occupancy", d: "How dependably it books", pts: 25 },
    { f: "Revenue scale", d: "Absolute earning power", pts: 20 },
    { f: "Regulatory ease", d: "Licence needed or not", pts: 15 },
  ];
  return (
    <div className="mxp-panel">
      <div className="mxp-panel-head">
        <span className="mxp-ring lg" style={{ ["--w" as string]: "72%" }}><b>B</b></span>
        <div>
          <strong>Stayful score</strong>
          <span>Four named factors. Every point shown.</span>
        </div>
      </div>
      <table className="mxp-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.f}>
              <td>{r.f}</td>
              <td className="muted">{r.d}</td>
              <td className="num"><Blur w={22} /> <span className="muted">/ {r.pts}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MockGauges() {
  return (
    <div className="mxp-gauges">
      <div className="mxp-gauge">
        <div className="mxp-gauge-arc amber" style={{ ["--w" as string]: "64%" }} />
        <strong>Busy</strong>
        <span>Competition</span>
        <small>Listing density · review depth · listing age</small>
      </div>
      <div className="mxp-gauge">
        <div className="mxp-gauge-arc" style={{ ["--w" as string]: "78%" }} />
        <strong>Strong</strong>
        <span>Direct-booking potential</span>
        <small>Contractors · hospitals · universities · events</small>
      </div>
    </div>
  );
}

export function MockCompare() {
  const cols = ["York", "Bristol", "Manchester"];
  const rows = ["Stayful score", "Avg revenue", "Occupancy", "Yield-on-cost", "Competition", "Licensing"];
  return (
    <div className="mxp-panel">
      <table className="mxp-table compare">
        <thead>
          <tr>
            <th />
            {cols.map((c) => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r}>
              <td>{r}</td>
              {cols.map((c, j) => (
                <td key={c} className={"num" + ((i + j) % 3 === 0 ? " best" : "")}><Blur w={40} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MockTrend() {
  // Illustrative shape only.
  const pts = [22, 26, 24, 31, 35, 33, 40, 44, 43, 49, 54, 58];
  const w = 320, h = 120, pad = 10;
  const max = Math.max(...pts), min = Math.min(...pts);
  const x = (i: number) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - 2 * pad);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(v)}`).join(" ");
  return (
    <div className="mxp-panel">
      <div className="mxp-panel-head">
        <div>
          <strong>UK market pulse</strong>
          <span>Enquiries · ADR · occupancy, month by month</span>
        </div>
        <span className="mxp-trend-badge"><Icon name="growth" size={13} /> Trending up</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mxp-trend" aria-hidden>
        <path d={`${d} L${x(pts.length - 1)} ${h - pad} L${x(0)} ${h - pad} Z`} fill="rgba(93,129,86,0.12)" />
        <path d={d} fill="none" stroke="#5d8156" strokeWidth={2.5} strokeLinecap="round" />
        {pts.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill="#2e3d2b" />)}
      </svg>
      <div className="mxp-trend-foot">Illustrative · real series builds from live analyser reports</div>
    </div>
  );
}
