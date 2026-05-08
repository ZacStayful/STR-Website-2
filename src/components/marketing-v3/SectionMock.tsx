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

// 02 Loading — video of the live data-ingest progress
function MockLoading() {
  return (
    <div className="mock mock-loading mock-loading-video">
      <video
        src="/assets/data-ingest.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label="Stayful live data ingest: locating property, fetching short-let data, long-let valuation, amenities and events from Airbtics, PropertyData, Google Places and Ticketmaster"
      />
    </div>
  );
}

// 03 Overview — video of the live decision-overview snapshot
function MockOverview() {
  return (
    <div className="mock mock-overview mock-overview-video">
      <video
        src="/assets/decision-overview.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label="Stayful decision overview: top market potential vs filtered estimate, net revenue after fees, ADR and occupancy"
      />
    </div>
  );
}

// 04 Comparables — video of the live comparables list
function MockComparables() {
  return (
    <div className="mock mock-comps mock-comps-video">
      <video
        src="/assets/comparables.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label="Stayful live comparables: nearby Airbnb listings with nightly rate, occupancy, annual revenue and reviews — exclude/include to refine your estimate"
      />
    </div>
  );
}

// 05 Amenities — screenshot of the live Advised Amenities panel
function MockAmenities() {
  return (
    <div className="mock mock-amenities mock-amenities-image">
      <img
        src="/assets/amenities.png"
        alt="Stayful Advised Amenities: Essential (WiFi, Kitchen — must have), Recommended (Garden, Workspace, Free Parking, Smart TV, Coffee Machine, High-Speed Internet, Printer, Meeting Space) and Unique Differentiators (Hot Tub, EV Charger, Pet Friendly, Pool, Smart Lock, High-Speed Internet) for the property's postcode"
        loading="lazy"
        decoding="async"
      />
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

// 09 Setup costs (id: bookings) — video of the live setup-cost builder
function MockSetup() {
  return (
    <div className="mock mock-setup mock-setup-video">
      <video
        src="/assets/setup-costs.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label="Stayful setup cost builder: furnishing line items with real Dunelm, Argos, Amazon and B&Q pricing"
      />
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
