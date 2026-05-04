// A3 — Side-by-side comparison panel.
// Left frame: the kind of thing a generic STR calculator gives you (a flat
// area average with no evidence). Right frame: Stayful's UI — actual nearby
// listings, customisable, with the user always one click from the answer.
// Built entirely in HTML/CSS so it never goes stale.
export function ComparisonShowcase() {
  return (
    <div className="sf-compare">
      <div className="sf-compare__frame sf-compare__frame--generic">
        <div className="sf-compare__chrome">
          <span className="sf-compare__dots" aria-hidden>
            <i /> <i /> <i />
          </span>
          <span className="sf-compare__url">other-tool.example</span>
        </div>
        <div className="sf-compare__inner">
          <p className="sf-compare__lede">Your area earns</p>
          <p className="sf-compare__bignum sf-compare__bignum--muted">~£35,000</p>
          <p className="sf-compare__sublede">per year, on average</p>
          <div className="sf-compare__gauge" aria-hidden>
            <span style={{ width: "62%" }} />
          </div>
          <ul className="sf-compare__deadlist">
            <li>No comparable listings shown</li>
            <li>No seasonality breakdown</li>
            <li>No way to customise to your property</li>
          </ul>
        </div>
        <div className="sf-compare__label sf-compare__label--muted">A flat market average</div>
      </div>

      <div className="sf-compare__divider" aria-hidden>
        <span>vs</span>
      </div>

      <div className="sf-compare__frame sf-compare__frame--stayful">
        <div className="sf-compare__chrome sf-compare__chrome--brand">
          <span className="sf-compare__brand-dot" />
          <span className="sf-compare__url sf-compare__url--brand">stayful.co.uk · live</span>
        </div>
        <div className="sf-compare__inner">
          <p className="sf-compare__lede">8 listings within 0.5 mi</p>
          <ul className="sf-compare__live">
            <li>
              <span className="sf-compare__listname">City Centre Penthouse</span>
              <span className="sf-compare__listmeta">0.3 mi · £165 · 65%</span>
            </li>
            <li>
              <span className="sf-compare__listname">Northern Quarter Loft</span>
              <span className="sf-compare__listmeta">0.5 mi · £155 · 63%</span>
            </li>
            <li>
              <span className="sf-compare__listname">Ancoats Modern Flat</span>
              <span className="sf-compare__listmeta">0.4 mi · £142 · 68%</span>
            </li>
            <li>
              <span className="sf-compare__listname">Piccadilly Village Apt</span>
              <span className="sf-compare__listmeta">0.2 mi · £170 · 62%</span>
            </li>
            <li className="sf-compare__livemore">+ 4 more &middot; de-select to refine</li>
          </ul>
          <div className="sf-compare__pillrow">
            <span className="sf-compare__pill">Customisable</span>
            <span className="sf-compare__pill">Seasonality</span>
            <span className="sf-compare__pill">Long-let comparison</span>
          </div>
        </div>
        <div className="sf-compare__label sf-compare__label--brand">
          The actual evidence — yours to refine
        </div>
      </div>
    </div>
  );
}
