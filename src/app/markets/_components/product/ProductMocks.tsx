import { Icon } from "@/lib/icons";
import { ProductMapVisual } from "./ProductMapVisual";

/**
 * Illustrative mock-ups of the v2 Market Explorer for the public product
 * page. Every number here is placeholder copy (blurred or clearly labelled
 * "Illustrative") — none of it is real Market Explorer output. The real
 * figures only ever render for signed-in members and the single sample area.
 */

const CARDS = [
  { name: "Harrogate", code: "HG", region: "Yorkshire", grade: "A", w: 82, conf: "Confirmed", lic: "No licence needed", saved: true, comparing: true },
  { name: "York", code: "YO", region: "Yorkshire", grade: "A", w: 78, conf: "Confirmed", lic: "No licence needed", saved: false, comparing: true },
  { name: "Bristol", code: "BS", region: "South West", grade: "B", w: 71, conf: "Building", lic: "Licence required", saved: false, comparing: false },
  { name: "Manchester", code: "M", region: "North West", grade: "B", w: 66, conf: "Confirmed", lic: "No licence needed", saved: false, comparing: false },
  { name: "Nottingham", code: "NG", region: "East Midlands", grade: "C", w: 58, conf: "Building", lic: "No licence needed", saved: true, comparing: false },
  { name: "Newcastle", code: "NE", region: "North East", grade: "C", w: 54, conf: "Early", lic: "Licensing unconfirmed", saved: false, comparing: false },
];

function Blur({ w = 48, h = 12 }: { w?: number; h?: number }) {
  return <span className="mxp-blur" style={{ width: w, height: h }} aria-hidden />;
}

function Kpi({ label, w = 44 }: { label: string; w?: number }) {
  return <div><Blur w={w} h={14} /><span>{label}</span></div>;
}

/** The find screen's filter bar: search-or-paste, four chip menus, the goals chip, All filters. */
export function MockFilterBar({ goals = true, compact = false }: { goals?: boolean; compact?: boolean }) {
  return (
    <div className={"mxp-filterbar" + (compact ? " compact" : "")} aria-hidden>
      <span className="mxp-search"><Icon name="search" size={13} /> Search a market, sub-market or postcode — or paste a listing link</span>
      <span className="mxp-chip">Region <Icon name="chevron" size={11} /></span>
      <span className="mxp-chip">Bedrooms <Icon name="chevron" size={11} /></span>
      {!compact && <span className="mxp-chip">Budget <Icon name="chevron" size={11} /></span>}
      {!compact && <span className="mxp-chip">Confidence <Icon name="chevron" size={11} /></span>}
      {goals ? (
        <span className="mxp-chip on"><Icon name="target" size={12} /> Your goals · ≤50 mi of NG2 · £200k–£350k · 2-bed</span>
      ) : (
        <span className="mxp-chip dashed"><Icon name="target" size={12} /> Set your goals</span>
      )}
      <span className="mxp-chip"><Icon name="chart" size={12} /> All filters</span>
    </div>
  );
}

/** The goals chips on their own (the goal profile step). */
export function MockGoalChips() {
  return (
    <div className="mxp-chips" aria-hidden>
      <span className="mxp-chip"><Icon name="pin" size={12} /> Within 50 miles of NG2</span>
      <span className="mxp-chip"><Icon name="bed" size={12} /> 2-bed</span>
      <span className="mxp-chip">£200k–£350k</span>
      <span className="mxp-chip on"><Icon name="target" size={12} /> Max yield</span>
      <span className="mxp-chip">Low competition</span>
      <span className="mxp-chip">Hands-off</span>
    </div>
  );
}

/** Markets | Sub-markets | My deals, the count and the sort. */
export function MockLevelRow({ level = 0, shown = "8 markets shown" }: { level?: 0 | 1 | 2; shown?: string }) {
  return (
    <div className="mxp-levelrow" aria-hidden>
      <span className="mxp-seg">
        {["Markets", "Sub-markets", "My deals"].map((l, i) => <span key={l} className={i === level ? "on" : undefined}>{l}{i === 2 && <em>3</em>}</span>)}
      </span>
      <span className="mxp-shown">{shown}</span>
      <span className="mxp-sort">Sort by <b>Market score ▾</b></span>
    </div>
  );
}

/** The v2 market cards: ring, name, three KPIs, tags, fit and a compare tick. */
export function MockCardGrid({ rows = 4, dense = false, fit = true, hover = "YO" }: { rows?: number; dense?: boolean; fit?: boolean; hover?: string | null }) {
  return (
    <div className={"mxp-cards" + (dense ? " dense" : "")} aria-hidden>
      {CARDS.slice(0, rows).map((c) => (
        <div key={c.code} className={"mxp-card" + (c.code === hover ? " is-hover" : "") + (c.comparing ? " is-comparing" : "")}>
          <div className="mxp-card-head">
            <span className="mxp-ring" style={{ ["--w" as string]: `${c.w}%` }}><b>{c.grade}</b></span>
            <span className="mxp-card-title"><strong>{c.name}</strong><small>{c.code} postcode area · {c.region}</small></span>
            <span className={"mxp-card-heart" + (c.saved ? " on" : "")}><Icon name="star" size={14} /></span>
          </div>
          <div className="mxp-card-kpis">
            <Kpi label="Revenue potential" w={42} />
            <Kpi label="Occupancy" w={30} />
            <Kpi label="Daily rate" w={34} />
          </div>
          <div className="mxp-card-foot">
            <span className={"mxp-tag " + (c.conf === "Confirmed" ? "accent" : c.conf === "Building" ? "amber" : "neutral")}>{c.conf}</span>
            <span className={"mxp-tag " + (c.lic.startsWith("No") ? "accent" : c.lic.startsWith("Licence") ? "amber" : "neutral")}>{c.lic}</span>
            <span className="mxp-card-fit">{fit ? <>Fit <Blur w={16} h={10} /></> : <u>Set goals</u>}</span>
            <span className={"mxp-check" + (c.comparing ? " on" : "")}>{c.comparing && <Icon name="check" size={10} color="#fff" />}</span>
            <span className="mxp-card-cmp">Compare</span>
          </div>
        </div>
      ))}
      <div className="mxp-list-lock"><Icon name="shield" size={13} /> Figures unlock with your free trial</div>
    </div>
  );
}

const BANDS = ["#cdd8c4", "#a2b299", "#6e8467", "#3a5634"];

/** The sticky choropleth: colour-by pill, four-band legend, and the hover card. */
export function MockMapPane({ compact = false, hoverCard = true, metric = "Market score" }: { compact?: boolean; hoverCard?: boolean; metric?: string }) {
  return (
    <div className={"mxp-mappane" + (compact ? " compact" : "")}>
      <ProductMapVisual highlight={["YO"]} compact={compact} />
      <div className="mxp-map-ctl" aria-hidden>
        <span className="mxp-map-metric">{metric} ▾</span>
        <div className="mxp-bands">
          {["< 60", "60 – 65", "65 – 70", "≥ 70"].map((l, i) => <div key={l}><i style={{ background: BANDS[i] }} />{l}</div>)}
          <div className="muted"><i style={{ background: "#f4f6f0", border: "1px solid #e4e7dc" }} />No data yet</div>
        </div>
      </div>
      {hoverCard && !compact && (
        <div className="mxp-pop" aria-hidden>
          <div className="mxp-pop-head"><span className="mxp-ring" style={{ ["--w" as string]: "78%" }}><b>A</b></span><strong>York</strong></div>
          <div className="mxp-pop-kpis"><Kpi label="Revenue potential" w={40} /><Kpi label="Occupancy" w={28} /><Kpi label="Daily rate" w={30} /></div>
          <span className="mxp-pop-btn">View market</span>
        </div>
      )}
      <div className="mxp-map-note" aria-hidden>Illustrative shading</div>
    </div>
  );
}

/** The market page's tab strip. */
export function MockTabs({ active = 0 }: { active?: number }) {
  const tabs = ["Overview", "Sub-markets", "Listings", "Occupancy", "Revenue", "Rates", "Seasonality", "Competition", "Licensing & regulation", "Long-let vs short-let", "Your deals"];
  return (
    <div className="mxp-tabs" aria-hidden>
      {tabs.map((t, i) => <span key={t} className={i === active ? "on" : undefined}>{t}</span>)}
    </div>
  );
}

/** "How is this market performing?": two rings and the four score components as bars. */
export function MockPerformance() {
  const bars = [
    { f: "Yield-on-cost", d: "revenue ÷ property value", pts: 40, w: 62 },
    { f: "Occupancy", d: "how dependably it books", pts: 25, w: 70 },
    { f: "Revenue scale", d: "absolute earning power", pts: 20, w: 48 },
    { f: "Regulatory ease", d: "licence needed or not", pts: 15, w: 100 },
  ];
  return (
    <div className="mxp-panel mxp-perf">
      <div className="mxp-panel-head"><div><strong>How is this market performing?</strong><span>Four named factors. Every point shown.</span></div></div>
      <div className="mxp-perf-body">
        <div className="mxp-perf-rings">
          <div><span className="mxp-ring lg" style={{ ["--w" as string]: "72%" }}><b>B</b></span><small>Market score</small></div>
          <div><span className="mxp-ring lg ink" style={{ ["--w" as string]: "81%" }}><b>A</b></span><small>Your fit</small></div>
        </div>
        <div className="mxp-perf-bars">
          {bars.map((b) => (
            <div key={b.f} className="mxp-bar">
              <div className="mxp-bar-head"><span>{b.f} <em>{b.d}</em></span><b><Blur w={18} h={10} /> / {b.pts}</b></div>
              <div className="mxp-bar-track"><div className="mxp-bar-fill" style={{ width: `${b.w}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
      <div className="mxp-signals" aria-hidden>
        {[["Licensing", "No licence needed"], ["Long-let vs short-let", "Short-let ahead"], ["Yield-on-cost", "—"], ["Data confidence", "Confirmed"], ["Enquiry trend", "Rising"]].map(([k, v]) => (
          <div key={k}><small>{k}</small><strong>{v === "—" ? <Blur w={36} h={12} /> : v}</strong></div>
        ))}
      </div>
    </div>
  );
}

export function MockGauges() {
  return (
    <div className="mxp-gauges">
      <div className="mxp-gauge">
        <div className="mxp-gauge-arc amber" style={{ ["--w" as string]: "64%" }} />
        <strong>Busy but beatable</strong>
        <span>Competition</span>
        <small>From the reviews of the comparables our reports analysed</small>
      </div>
      <div className="mxp-gauge">
        <div className="mxp-gauge-arc" style={{ ["--w" as string]: "78%" }} />
        <strong>Strong</strong>
        <span>Direct-booking potential</span>
        <small>Contractors · hospitals · universities · events · transport</small>
      </div>
    </div>
  );
}

/** The compare dock and the side-by-side table. */
export function MockCompare() {
  const cols = ["York", "Bristol", "Manchester"];
  const rows = ["Market score", "Your fit", "Avg revenue / yr", "Occupancy", "Daily rate", "Yield-on-cost", "Competition", "Licensing"];
  return (
    <div className="mxp-mock-stack">
      <div className="mxp-dock" aria-hidden>
        <strong>Comparing 3 of 4</strong>
        {cols.map((c) => <span key={c} className="mxp-dock-chip">{c} <b><Blur w={14} h={9} /></b> ×</span>)}
        <span className="mxp-dock-btn">Compare side by side</span>
      </div>
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
    </div>
  );
}

/** The My deals level: the paste box and the pipeline with verdicts. */
export function MockDeals() {
  const deals = [
    { title: "3-bed terrace, Lenton", meta: "£265,000 · 3 bed · Nottingham", verdict: "Works", tone: "works", status: "Viewing booked" },
    { title: "2-bed apartment, Kelham Island", meta: "£210,000 · 2 bed · Sheffield", verdict: "Tight", tone: "tight", status: "Watching" },
    { title: "2-bed flat, Baltic Triangle", meta: "£1,150 pcm · rent-to-rent · Liverpool", verdict: "Doesn’t work", tone: "no", status: "Passed" },
  ];
  return (
    <div className="mxp-mock-stack" aria-hidden>
      <span className="mxp-search is-link"><Icon name="search" size={13} /> https://www.rightmove.co.uk/properties/1482… <b>Check listing</b></span>
      <MockLevelRow level={2} shown="3 checked" />
      <div className="mxp-deals">
        {deals.map((d) => (
          <div key={d.title} className="mxp-deal">
            <span className="mxp-deal-thumb">RIGHTMOVE</span>
            <span className="mxp-deal-main"><strong>{d.title}</strong><small>{d.meta}</small><span className={`mxp-vchip ${d.tone}`}>{d.verdict}</span> <em>{d.status}</em></span>
            <span className="mxp-deal-num"><Blur w={40} h={14} /><small>gross yield</small></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A monthly line card with the "vs prior 3 mo" delta tag, plus the KPI strip. */
export function MockTrend() {
  // Illustrative shape only.
  const pts = [22, 26, 24, 31, 35, 33, 40, 44, 43, 49, 54, 58];
  const w = 320, h = 110, pad = 10;
  const max = Math.max(...pts), min = Math.min(...pts);
  const x = (i: number) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - 2 * pad);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(v)}`).join(" ");
  const months = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  return (
    <div className="mxp-mock-stack">
      <div className="mxp-kpis" aria-hidden>
        {[["Annual revenue", "+8% vs prior 3 mo", "up"], ["Enquiries, last 3 months", "+12% vs prior 3 mo", "up"], ["Average daily rate", "Steady vs prior 3 mo", "flat"], ["Occupancy rate", "−3% vs prior 3 mo", "down"]].map(([k, t, tone]) => (
          <div key={k} className="mxp-kpi"><small>{k}</small><Blur w={56} h={18} /><span className={`mxp-tag ${tone === "up" ? "accent" : tone === "down" ? "down" : "neutral"}`}>{t}</span></div>
        ))}
      </div>
      <div className="mxp-panel">
        <div className="mxp-panel-head">
          <div><strong>Average listing revenue</strong><span>Twelve months of averages, month by month</span></div>
          <span className="mxp-trend-badge"><Icon name="growth" size={13} /> +8% vs prior 3 mo</span>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="mxp-trend" aria-hidden>
          <line x1={pad} x2={w - pad} y1={h - pad + 2} y2={h - pad + 2} stroke="#2e3d2b" strokeWidth={1.5} />
          <path d={d} fill="none" stroke="#5d8156" strokeWidth={2.5} strokeLinecap="round" />
          {pts.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.4} fill="#5d8156" />)}
        </svg>
        <div className="mxp-trend-months" aria-hidden>{months.map((m) => <span key={m}>{m}</span>)}</div>
        <div className="mxp-trend-foot">Illustrative · the real series builds from live analyser reports; months with fewer than three reports are left as gaps</div>
      </div>
    </div>
  );
}
