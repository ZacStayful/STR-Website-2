// A3 — Side-by-side comparison panel.
// Left frame: a generic STR calculator's flat area average with no evidence.
// Right frame: Stayful's dual-estimate mechanic — a Top Market Potential
// computed from all nearby comparables, and Your Filtered Estimate that
// updates live as the user de-selects comparables that don't match.
// Both Stayful figures carry a "sample" pill so the marketing surface
// stays evidence-bound rather than predictive.
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
            <li>No way to remove what doesn&rsquo;t match</li>
            <li>One number, take it or leave it</li>
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
          <span className="sf-compare__url sf-compare__url--brand">stayful.co.uk &middot; live</span>
          <span className="sf-compare__samplepill">Sample</span>
        </div>
        <div className="sf-compare__inner">
          <div className="sf-compare__estimates">
            <div className="sf-compare__estimate">
              <span className="sf-compare__estimate-label">Top market potential</span>
              <p className="sf-compare__bignum sf-compare__bignum--featured">£52,400</p>
              <span className="sf-compare__estimate-foot">All 8 comparables</span>
            </div>
            <div className="sf-compare__estimate sf-compare__estimate--filtered">
              <span className="sf-compare__estimate-label">Your filtered estimate</span>
              <p className="sf-compare__bignum sf-compare__bignum--filtered">£41,200</p>
              <span className="sf-compare__estimate-foot">5 of 8 selected</span>
            </div>
          </div>
          <ul className="sf-compare__live">
            <li>
              <span className="sf-compare__check sf-compare__check--on" aria-hidden>✓</span>
              <span className="sf-compare__listname">Northern Quarter Loft</span>
              <span className="sf-compare__listmeta">0.5 mi &middot; £155 &middot; 63%</span>
            </li>
            <li>
              <span className="sf-compare__check sf-compare__check--on" aria-hidden>✓</span>
              <span className="sf-compare__listname">Ancoats Modern Flat</span>
              <span className="sf-compare__listmeta">0.4 mi &middot; £142 &middot; 68%</span>
            </li>
            <li className="is-deselected">
              <span className="sf-compare__check sf-compare__check--off" aria-hidden>✗</span>
              <span className="sf-compare__listname">5&star; Penthouse Suite</span>
              <span className="sf-compare__listmeta">Doesn&rsquo;t match yours</span>
            </li>
            <li className="is-deselected">
              <span className="sf-compare__check sf-compare__check--off" aria-hidden>✗</span>
              <span className="sf-compare__listname">Luxury Executive Apt</span>
              <span className="sf-compare__listmeta">Doesn&rsquo;t match yours</span>
            </li>
            <li className="sf-compare__livemore">+ 4 more &middot; tap any to include or exclude</li>
          </ul>
          <p className="sf-compare__caption">
            <strong>Top</strong> = all comparables. <strong>Filtered</strong> = the
            ones that match. De-select what doesn&rsquo;t fit; your estimate
            updates live.
          </p>
        </div>
        <div className="sf-compare__label sf-compare__label--brand">
          The actual evidence &mdash; yours to refine
        </div>
      </div>
    </div>
  );
}
