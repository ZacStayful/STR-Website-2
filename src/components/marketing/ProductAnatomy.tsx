// B4 — Exploded product anatomy.
// Polished mockup of the analyser report broken into floating panels with
// thin sage annotation lines pointing at each component.
// Used as the hero on /features so the page opens with a visual answer to
// "what does the software produce?".
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

          <div className="sf-anatomy__row">
            <div className="sf-anatomy__cell" data-key="comparables">
              <span className="sf-anatomy__cell-label">Comparables</span>
              <ul className="sf-anatomy__cell-list">
                <li><strong>City Centre Penthouse</strong><span>0.3 mi · £165 · 65%</span></li>
                <li><strong>Northern Quarter Loft</strong><span>0.5 mi · £155 · 63%</span></li>
                <li><strong>Ancoats Modern Flat</strong><span>0.4 mi · £142 · 68%</span></li>
                <li className="sf-anatomy__more">+ 5 more</li>
              </ul>
            </div>

            <div className="sf-anatomy__cell" data-key="seasonality">
              <span className="sf-anatomy__cell-label">Seasonal monthly view</span>
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

          <div className="sf-anatomy__row">
            <div className="sf-anatomy__cell" data-key="long-let">
              <span className="sf-anatomy__cell-label">Long-let comparison</span>
              <p className="sf-anatomy__cell-figure">Side by side</p>
              <span className="sf-anatomy__cell-foot">PropertyData benchmark</span>
            </div>

            <div className="sf-anatomy__cell" data-key="profit">
              <span className="sf-anatomy__cell-label">Profit calculator</span>
              <p className="sf-anatomy__cell-figure">Adjustable</p>
              <span className="sf-anatomy__cell-foot">Mortgage, bills, mgmt</span>
            </div>

            <div className="sf-anatomy__cell" data-key="risk">
              <span className="sf-anatomy__cell-label">Risk score</span>
              <p className="sf-anatomy__cell-figure">/100</p>
              <span className="sf-anatomy__cell-foot">9 dimensions</span>
            </div>
          </div>

          <div className="sf-anatomy__foot">
            Exportable report &middot; PDF in one click
          </div>
        </div>

        {/* Annotations — positioned absolutely on desktop, stacked on mobile */}
        <ul className="sf-anatomy__annotations">
          <li className="sf-anatomy__ann sf-anatomy__ann--tl">
            <strong>Live nearby comparables</strong>
            <span>Up to 40 listings, named, weighted by review count</span>
          </li>
          <li className="sf-anatomy__ann sf-anatomy__ann--tr">
            <strong>12-month seasonal view</strong>
            <span>Where the income lands, not annual ÷ 12</span>
          </li>
          <li className="sf-anatomy__ann sf-anatomy__ann--bl">
            <strong>Long-let benchmark</strong>
            <span>Calibrated against current UK rental data</span>
          </li>
          <li className="sf-anatomy__ann sf-anatomy__ann--br">
            <strong>Profit + risk overlay</strong>
            <span>Net profit at your inputs, risk on a /100 scale</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
