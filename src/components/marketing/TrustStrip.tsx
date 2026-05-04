// C2 — Trust strip.
// Sage-tinted band listing the data sources the software draws from.
// Specificity = credibility. No images required.
const SOURCES = [
  "Airbnb",
  "Booking.com",
  "PropertyData",
  "Google Places",
  "Ticketmaster",
  "Stayful managed portfolio",
];

export function TrustStrip() {
  return (
    <div className="sf-truststrip" role="region" aria-label="Data sources">
      <span className="sf-truststrip__lede">Built from live data:</span>
      <ul className="sf-truststrip__list">
        {SOURCES.map((s) => (
          <li key={s}>
            <span className="sf-truststrip__dot" aria-hidden />
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}
