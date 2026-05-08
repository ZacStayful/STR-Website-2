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

// 01 Intake — video of the live property-intake form
function MockIntake() {
  return (
    <div className="mock mock-intake mock-intake-video">
      <video
        src="/assets/property-intake.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label="Stayful property intake: UK address autocomplete with auto-detected postcode, property type, bedrooms, bathrooms, max guests, parking and outdoor space"
      />
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

// 10 Risk — video of the live risk-assessment panel
function MockRisk() {
  return (
    <div className="mock mock-risk mock-risk-video">
      <video
        src="/assets/risk-assessment.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label="Stayful risk assessment: council short-let regulation, supply saturation, seasonality concentration and single-channel dependency"
      />
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
