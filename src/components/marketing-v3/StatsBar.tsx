const STATS = [
  { num: "10", label: "Section deep-dive", sub: "From intake to risk assessment" },
  { num: "4+", label: "Live data sources", sub: "Airbnb, PropertyData, Google, Ticketmaster" },
  { num: "10–20s", label: "End-to-end analysis", sub: "Live comparables and demand drivers" },
  { num: "Try for free", label: "Start your free trial", sub: "Get 5 free reports today" },
];

const DATA_SOURCES = [
  "Airbtics",
  "PropertyData",
  "Google Places",
  "Ticketmaster",
  "EPC Register",
  "Companies House",
];

export function StatsBar() {
  return (
    <section className="stats-bar">
      <div className="wrap">
        <div className="stats-grid">
          {STATS.map((s, i) => (
            <div key={i} className="stat-cell">
              <div className="stat-num">{s.num}</div>
              <div className="stat-label">{s.label}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>
        <div className="data-sources">
          <span className="eyebrow">Live data partners</span>
          <div className="data-source-list">
            {DATA_SOURCES.map((src, i) => (
              <span key={src} style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
                <span>{src}</span>
                {i < DATA_SOURCES.length - 1 && <span className="data-sep" />}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
