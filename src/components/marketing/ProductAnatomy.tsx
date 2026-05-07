// B4 — Exploded product anatomy.
// Polished mockup of the analyser report broken into floating panels with
// thin sage annotation lines pointing at each component. Mirrors the live
// analyser sidebar — Comparables, Profit calc, Forecast, Demand drivers,
// Amenities, Risk, Growth. Bookings is intentionally absent (it's a
// placeholder in the live product) and there is no "Book your action plan"
// CTA (also a placeholder).
export function ProductAnatomy() {
  return (
    <div className="sf-anatomy">
      <div className="sf-anatomy__stage">
        {/* Center spine — the report */}
        <div className="sf-anatomy__report">
          <div className="sf-anatomy__chrome">
            <span className="sf-anatomy__brand-dot" />
            <span className="sf-anatomy__brand">Stayful · property analysis</span>
            <span className="sf-anatomy__sample">Sample property</span>
          </div>

          <div className="sf-anatomy__head">
            <h4>1 Albion Street, Manchester M1</h4>
            <p>2-bed flat &middot; sleeps 4</p>
          </div>

          {/* Row 1: Comparables (wide) + Forecast */}
          <div className="sf-anatomy__row sf-anatomy__row--main">
            <div className="sf-anatomy__cell" data-key="comparables">
              <span className="sf-anatomy__cell-label">Comparables</span>
              <ul className="sf-anatomy__cell-list">
                <li><strong>City Centre Penthouse</strong><span>0.3 mi &middot; £165 &middot; 65%</span></li>
                <li><strong>Northern Quarter Loft</strong><span>0.5 mi &middot; £155 &middot; 63%</span></li>
                <li><strong>Ancoats Modern Flat</strong><span>0.4 mi &middot; £142 &middot; 68%</span></li>
                <li className="sf-anatomy__more">+ 5 more</li>
              </ul>
            </div>

            <div className="sf-anatomy__cell" data-key="forecast">
              <span className="sf-anatomy__cell-label">Forecast &middot; monthly view</span>
              <div className="sf-anatomy__bars" aria-hidden>
                {[42, 38, 50, 58, 62, 84, 92, 86, 74, 60, 50, 34].map((h, i) => (
                  <span
                    key={i}
                    style={{ height: `${h}%` }}
                    className={i === 6 ? "is-peak" : ""}
                  />
                ))}
              </div>
              <span className="sf-anatomy__cell-foot">Peak: July &middot; trough: Dec</span>
            </div>
          </div>

          {/* Row 2: Profit + Risk + Growth */}
          <div className="sf-anatomy__row sf-anatomy__row--triple">
            <div className="sf-anatomy__cell" data-key="profit">
              <span className="sf-anatomy__cell-label">Profit calculator</span>
              <p className="sf-anatomy__cell-figure">Adjustable</p>
              <span className="sf-anatomy__cell-foot">Mortgage, bills, mgmt</span>
            </div>

            <div className="sf-anatomy__cell" data-key="risk">
              <span className="sf-anatomy__cell-label">Risk score</span>
              <p className="sf-anatomy__cell-figure">/100</p>
              <span className="sf-anatomy__cell-foot">Seasonality &middot; regulation &middot; platform</span>
            </div>

            <div className="sf-anatomy__cell" data-key="growth">
              <span className="sf-anatomy__cell-label">Growth trajectory</span>
              <div className="sf-anatomy__growth" aria-hidden>
                <span className="sf-anatomy__growth-dot" data-yr="Y1" />
                <span className="sf-anatomy__growth-line" />
                <span className="sf-anatomy__growth-dot" data-yr="Y2" />
                <span className="sf-anatomy__growth-line" />
                <span className="sf-anatomy__growth-dot sf-anatomy__growth-dot--peak" data-yr="Y3" />
              </div>
              <span className="sf-anatomy__cell-foot">Yr 1 &rarr; 2 &rarr; 3 stabilises</span>
            </div>
          </div>

          {/* Row 3: Demand drivers + Amenities advisory */}
          <div className="sf-anatomy__row sf-anatomy__row--double">
            <div className="sf-anatomy__cell" data-key="demand">
              <span className="sf-anatomy__cell-label">Demand drivers</span>
              <div className="sf-anatomy__chips">
                <span>University &middot; 0.4 mi</span>
                <span>Hospital &middot; 0.7 mi</span>
                <span>Station &middot; 0.3 mi</span>
                <span>Arena &middot; 0.6 mi</span>
              </div>
              <span className="sf-anatomy__cell-foot">Why bookings happen here</span>
            </div>

            <div className="sf-anatomy__cell" data-key="amenities">
              <span className="sf-anatomy__cell-label">Amenities advisory</span>
              <ul className="sf-anatomy__advice">
                <li><span className="sf-anatomy__yes" aria-hidden>✓</span> Hot tub adds ~12% bookings</li>
                <li><span className="sf-anatomy__yes" aria-hidden>✓</span> EV charger in 30% of comps</li>
                <li><span className="sf-anatomy__no" aria-hidden>✗</span> Pool not justified here</li>
              </ul>
            </div>
          </div>

          <div className="sf-anatomy__foot">
            Exportable report &middot; PDF in one click
          </div>
        </div>

        {/* Annotations — positioned absolutely on desktop, hidden below 1280px */}
        <ul className="sf-anatomy__annotations">
          <li className="sf-anatomy__ann sf-anatomy__ann--tl">
            <strong>Live nearby comparables</strong>
            <span>Up to 40 listings, named, weighted by review count</span>
          </li>
          <li className="sf-anatomy__ann sf-anatomy__ann--tr">
            <strong>12-month forecast</strong>
            <span>Where the income lands, not annual ÷ 12</span>
          </li>
          <li className="sf-anatomy__ann sf-anatomy__ann--bl">
            <strong>Demand &middot; amenities</strong>
            <span>Why this area earns and what to add to lift it</span>
          </li>
          <li className="sf-anatomy__ann sf-anatomy__ann--br">
            <strong>Profit &middot; risk &middot; growth</strong>
            <span>Net profit, risk on /100, multi-year trajectory</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
