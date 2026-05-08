// 11 self-contained mini-mockups, one per analyser section.
// Verbatim port of the Drive bundle's section-mocks.jsx (sample data for
// 17 Park Crescent, York). Each mock teaches what that part of the report
// looks like — they're rendered inside the Walkthrough's right column.

import { Icon, type IconName } from "@/lib/icons";

interface SectionMockProps {
  id: string;
  active?: boolean;
}

export function SectionMock({ id, active }: SectionMockProps) {
  const Comp = MOCK_BY_ID[id] ?? MockOverview;
  return (
    <div className={"section-mock " + (active ? "active" : "")}>
      <div className="section-mock-frame">
        <Comp />
      </div>
      <div className="section-mock-shadow" aria-hidden />
    </div>
  );
}

// 01 Intake
function MockIntake() {
  return (
    <div className="mock mock-intake">
      <div className="mock-title">
        <Icon name="search" size={14} color="var(--sage-600)" /> Analyse Your
        Property
      </div>
      <div className="mock-pill">
        <Icon name="check" size={13} color="var(--sage-600)" /> 17 Park Crescent,
        York <span className="mock-pill-cta">Change</span>
      </div>
      <div className="mock-row">
        <div className="mock-field">
          <label>Postcode</label>
          <div className="mock-input">YO31 7NU</div>
        </div>
        <div className="mock-field">
          <label>Property Type</label>
          <div className="mock-input">Terraced ▾</div>
        </div>
      </div>
      <div className="mock-row">
        <div className="mock-field">
          <label>Bedrooms</label>
          <div className="mock-input">3</div>
        </div>
        <div className="mock-field">
          <label>Bathrooms</label>
          <div className="mock-input">2</div>
        </div>
        <div className="mock-field">
          <label>Max Guests</label>
          <div className="mock-input">8</div>
        </div>
      </div>
      <div className="mock-row">
        <div className="mock-field">
          <label>Parking</label>
          <div className="mock-input">No parking ▾</div>
        </div>
        <div className="mock-field">
          <label>Outdoor Space</label>
          <div className="mock-input">Garden ▾</div>
        </div>
      </div>
    </div>
  );
}

// 02 Loading
function MockLoading() {
  const steps = [
    "Locating property",
    "Fetching short-let data",
    "Fetching long-let valuation",
    "Finding amenities",
    "Discovering events",
    "Running analysis",
  ];
  return (
    <div className="mock mock-loading">
      <div className="mock-loading-title">
        <Icon name="loading" size={14} color="var(--sage-600)" /> Analysing your
        property…
      </div>
      <div className="mock-progress">
        <div className="mock-progress-fill" style={{ width: "62%" }} />
      </div>
      <div className="mock-progress-pct">62% complete</div>
      <div className="mock-step-list">
        {steps.map((s, i) => (
          <div
            key={s}
            className={
              "mock-step " + (i < 3 ? "done" : i === 3 ? "active" : "")
            }
          >
            <span className="mock-step-circle">
              {i < 3 ? <Icon name="check" size={10} stroke={2.5} /> : null}
            </span>
            <span className={i < 3 ? "strike" : ""}>{s}…</span>
          </div>
        ))}
      </div>
      <div className="mock-foot">
        Airbtics · PropertyData · Google Places · Ticketmaster
      </div>
    </div>
  );
}

// 03 Overview
function MockOverview() {
  return (
    <div className="mock mock-overview">
      <div className="mock-overview-status">
        <Icon name="check" size={12} stroke={2.5} /> Analysis Complete
      </div>
      <h4 className="mock-h">17 Park Crescent, York</h4>
      <div className="mock-h-sub">3 bed · 2 bath · Sleeps 8</div>
      <div className="mock-overview-grid">
        <div>
          <div className="mock-stat-l">Top market potential</div>
          <div className="mock-big">
            £59,508 <span>£4,959/mo</span>
          </div>
        </div>
        <div>
          <div className="mock-stat-l">Filtered estimate</div>
          <div className="mock-big">
            £42,180 <span>£3,515/mo</span>
          </div>
        </div>
        <div>
          <div className="mock-stat-l">Net revenue</div>
          <div className="mock-big mid">£30,940</div>
        </div>
        <div>
          <div className="mock-stat-l">ADR · Occupancy</div>
          <div className="mock-big mid">£207 · 78%</div>
        </div>
      </div>
      <div className="mock-overview-range">
        <span>Property value range</span>
        <div className="mock-range-bar">
          <div className="mock-range-fill" />
        </div>
        <div className="mock-range-vals">
          <span>£280,000</span>
          <span>£350,000</span>
        </div>
      </div>
    </div>
  );
}

// 04 Comparables
function MockComparables() {
  const comps = [
    { title: "Spacious York Home for 10", meta: "3b · 10g · 0.06km", n: "£212", o: "89%", a: "£66,953", top: true },
    { title: "Monkbridge Mews", meta: "2b · 6g · 0.06km", n: "£198", o: "83%", a: "£62,149", top: true },
    { title: "Fab city house", meta: "3b · 6g · 0.07km", n: "£153", o: "82%", a: "£36,699", top: false },
    { title: "The Garden Cottage", meta: "2b · 4g · 0.11km", n: "£165", o: "76%", a: "£42,820", top: false },
  ];
  return (
    <div className="mock mock-comps">
      <div className="mock-h-row">
        <h4 className="mock-h">Live comparables</h4>
        <span className="mock-tag">12 nearby</span>
      </div>
      <div className="mock-comp-list">
        {comps.map((c, i) => (
          <div key={i} className="mock-comp">
            <div className="mock-comp-img" />
            <div className="mock-comp-body">
              <div className="mock-comp-title">
                {c.title}
                {c.top && <span className="mock-tag-sm">Top</span>}
              </div>
              <div className="mock-comp-meta">{c.meta}</div>
              <div className="mock-comp-stats">
                <div>
                  <span>Nightly</span>
                  <strong>{c.n}</strong>
                </div>
                <div>
                  <span>Occ</span>
                  <strong>{c.o}</strong>
                </div>
                <div>
                  <span>Annual</span>
                  <strong>{c.a}</strong>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 05 Amenities
function MockAmenities() {
  const items: { name: string; sub: string; impact: "High" | "Medium" | "Low"; icon: IconName }[] = [
    { name: "York Hospital", sub: "0.75 km · Healthcare", impact: "Medium", icon: "shield" },
    { name: "University of York", sub: "2.64 km · Education", impact: "Medium", icon: "amenities" },
    { name: "York Minster", sub: "0.55 km · Tourism", impact: "High", icon: "pin" },
    { name: "York (YRK) Station", sub: "1.45 km · Transport", impact: "High", icon: "map" },
    { name: "Construction projects", sub: "5 within 40 km", impact: "High", icon: "rocket" },
    { name: "Events & Entertainment", sub: "Live data feed", impact: "Medium", icon: "spark" },
  ];
  return (
    <div className="mock mock-amenities">
      <h4 className="mock-h">Demand drivers</h4>
      <div className="mock-amen-grid">
        {items.map((it) => (
          <div key={it.name} className="mock-amen">
            <div className={"mock-amen-icon impact-" + it.impact.toLowerCase()}>
              <Icon name={it.icon} size={14} color="var(--sage-700)" />
            </div>
            <div>
              <div className="mock-amen-name">{it.name}</div>
              <div className="mock-amen-sub">{it.sub}</div>
            </div>
            <div className={"mock-amen-tag impact-" + it.impact.toLowerCase()}>
              {it.impact}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 06 Revenue breakdown — video of the live profit calculator running
function MockRevenue() {
  return (
    <div className="mock mock-revenue mock-revenue-video">
      <video
        src="/assets/profit-breakdown.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label="Stayful profit calculator: live walkthrough of gross-to-net revenue"
      />
    </div>
  );
}

// 07 Forecast — video of the 12-month forecast running
function MockForecast() {
  return (
    <div className="mock mock-forecast mock-forecast-video">
      <video
        src="/assets/12-month-forecast.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label="Stayful 12-month forecast: month-by-month occupancy and revenue projection"
      />
    </div>
  );
}

// 08 Local area — screenshot of the live Local Area Intelligence panel
function MockLocal() {
  return (
    <div className="mock mock-local mock-local-image">
      <img
        src="/assets/local-area.png"
        alt="Stayful Local Area Intelligence: demand drivers and attractions near the property — Healthcare Facilities (York Hospital), Educational Institutions (University of York), Construction Projects (Leeds Bradford Airport, high impact), Events & Entertainment (York YRK)"
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

// 09 Setup costs (id: bookings)
function MockSetup() {
  const rows = [
    { l: "Double beds (×3)", v: "£1,050" },
    { l: "Sofabed", v: "£750" },
    { l: "Coffee + dining table", v: "£450" },
    { l: "Soft furnishings (per room)", v: "£1,200" },
    { l: "Paint (per room)", v: "£400" },
    { l: "Appliances & tech", v: "£680" },
    { l: "Kitchen", v: "£350" },
  ];
  return (
    <div className="mock mock-setup">
      <h4 className="mock-h">Setup cost summary</h4>
      <div className="mock-setup-grid">
        <div className="mock-setup-list">
          {rows.map((r, i) => (
            <div key={i} className="mock-setup-row">
              <span>
                <span className="mock-tick" /> {r.l}
              </span>
              <span>{r.v}</span>
            </div>
          ))}
        </div>
        <div className="mock-setup-card">
          <div className="mock-setup-total-l">Grand total</div>
          <div className="mock-setup-total-v">£6,240</div>
          <div className="mock-setup-foot">14 items · Dunelm, Argos, Amazon, B&amp;Q</div>
          <button className="mock-setup-btn">Copy quote</button>
        </div>
      </div>
    </div>
  );
}

// 10 Risk
function MockRisk() {
  const risks = [
    { l: "Council short-let regulation", level: "Low", w: 25 },
    { l: "Supply saturation (postcode)", level: "Medium", w: 55 },
    { l: "Seasonality concentration", level: "Medium", w: 48 },
    { l: "Single-channel dependency", level: "High", w: 78 },
  ];
  return (
    <div className="mock mock-risk">
      <h4 className="mock-h">Risk assessment</h4>
      <div className="mock-risk-overall">
        <div className="mock-risk-circle">
          <span className="mock-risk-num">52</span>
          <span className="mock-risk-of">/100</span>
        </div>
        <div>
          <div className="mock-risk-overall-l">Overall risk</div>
          <div className="mock-risk-overall-v">Moderate</div>
        </div>
      </div>
      <div className="mock-risk-list">
        {risks.map((r, i) => (
          <div key={i} className="mock-risk-row">
            <div className="mock-risk-r-head">
              <span>{r.l}</span>
              <span className={"mock-risk-tag risk-" + r.level.toLowerCase()}>{r.level}</span>
            </div>
            <div className="mock-risk-bar">
              <div
                className={"mock-risk-fill risk-" + r.level.toLowerCase()}
                style={{ width: r.w + "%" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 11 Growth
function MockGrowth() {
  const actions = [
    { l: "Professional photography", impact: "+12% nightly", priority: 1 },
    { l: "Direct booking site setup", impact: "+8% net retention", priority: 2 },
    { l: "List on Booking.com + VRBO", impact: "+15% occupancy", priority: 3 },
    { l: "Mid-week minimum stay = 1 night", impact: "+6% occupancy", priority: 4 },
    { l: "Hospital corporate outreach", impact: "+18% direct bookings", priority: 5 },
  ];
  return (
    <div className="mock mock-growth">
      <h4 className="mock-h">Growth playbook</h4>
      <div className="mock-growth-sub">Ranked by lift on filtered estimate</div>
      <div className="mock-growth-list">
        {actions.map((a) => (
          <div key={a.priority} className="mock-growth-row">
            <div className="mock-growth-rank">{a.priority}</div>
            <div>
              <div className="mock-growth-l">{a.l}</div>
              <div className="mock-growth-impact">
                <Icon name="growth" size={11} color="var(--sage-500)" /> {a.impact}
              </div>
            </div>
            <Icon name="arrow" size={13} color="var(--sage-500)" />
          </div>
        ))}
      </div>
    </div>
  );
}

const MOCK_BY_ID: Record<string, () => React.ReactElement> = {
  intake: MockIntake,
  loading: MockLoading,
  overview: MockOverview,
  comparables: MockComparables,
  amenities: MockAmenities,
  revenue: MockRevenue,
  forecast: MockForecast,
  local: MockLocal,
  bookings: MockSetup,
  risk: MockRisk,
  growth: MockGrowth,
};
