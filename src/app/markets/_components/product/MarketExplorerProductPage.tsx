import Link from "next/link";
import { Icon } from "@/lib/icons";
import { Pricing } from "@/components/marketing-v3/Pricing";
import { getSampleArea } from "@/lib/market/cached";
import { STR_LICENSING } from "@/lib/data/str-licensing";
import { ProductHeroVisual } from "./ProductHeroVisual";
import { ProductWalkthrough } from "./ProductWalkthrough";
import { ProductFaq } from "./ProductFaq";
import { SampleArea } from "./SampleArea";
import { MarketPulse } from "../explorer/MarketPulse";
import { fetchMarketTrends } from "@/lib/market/trends-client";

const SIGNUP = "/signup?next=/markets";
const LOGIN = "/login?redirect=/markets";

/**
 * Public, members-only-teaser page for the Market Explorer. Rendered by the
 * /markets layout for signed-out visitors instead of the explorer itself.
 * Explains in depth what the tool is and does, with illustrative visuals and
 * ONE live sample area — never the full dataset.
 */
export async function MarketExplorerProductPage() {
  const [sample, trends] = await Promise.all([getSampleArea(), fetchMarketTrends()]);
  const licensingEntries = Object.keys(STR_LICENSING).length;
  const areaCount = sample?.totalAreas ?? null;
  const reportCount = sample?.totalSamples ?? null;

  return (
    <div className="mxp">
      {/* ── Hero ── */}
      <section className="hero mxp-hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow"><span className="dot" /> Stayful Market Explorer</span>
            <h1>
              Find the UK areas where short-lets <span className="hero-script">actually pay.</span>
            </h1>
            <p className="lede">
              Every UK postcode area, ranked by real short-term rental performance: revenue,
              occupancy, yield-on-cost, competition, licensing and direct-booking potential.
              Then tailored to your goals, so the top of the list is the top of <em>your</em> list.
            </p>
            <div className="mxp-hero-ctas">
              <Link href={SIGNUP} className="btn btn-primary">
                Start free trial <Icon name="arrow" size={16} />
              </Link>
              <Link href={LOGIN} className="btn btn-ghost">
                Sign in
              </Link>
            </div>
            <div className="hero-meta row gap-24" style={{ flexWrap: "wrap" }}>
              <span><Icon name="check" size={14} color="var(--sage-500)" /> Included in the free trial</span>
              <span><Icon name="check" size={14} color="var(--sage-500)" /> No card required</span>
              <span><Icon name="check" size={14} color="var(--sage-500)" /> Every score shows its working</span>
            </div>
          </div>
          <div className="hero-demo">
            <ProductHeroVisual />
          </div>
        </div>
      </section>

      {/* ── What it is ── */}
      <section className="section-tight mxp-what">
        <div className="wrap-narrow">
          <div className="eyebrow">What it is</div>
          <h2>The &ldquo;where&rdquo; before the &ldquo;which&rdquo;.</h2>
          <p className="lede">
            The Stayful analyser tells you what a specific address would earn. The Market Explorer
            answers the question that comes first: <strong>where in the UK should I be looking at all?</strong>{" "}
            It pools every analysis we run into one living picture of the market, area by area, and
            ranks it against what you personally want from an investment.
          </p>
          <div className="mxp-three">
            <div className="mxp-three-card">
              <span className="mxp-three-icon"><Icon name="chart" size={20} color="var(--sage-600)" /></span>
              <h3>Ranked by what matters</h3>
              <p>
                Average revenue, daily rate, occupancy and yield-on-cost for every area and bedroom
                count, rolled into a transparent 0–100 score. Sort by any of them, or by the score.
              </p>
            </div>
            <div className="mxp-three-card">
              <span className="mxp-three-icon"><Icon name="eye" size={20} color="var(--sage-600)" /></span>
              <h3>See the competition</h3>
              <p>
                How crowded each market is, how entrenched the existing hosts are, what the licensing
                rules say, and whether guests there have reasons to book direct.
              </p>
            </div>
            <div className="mxp-three-card">
              <span className="mxp-three-icon"><Icon name="target" size={20} color="var(--sage-600)" /></span>
              <h3>Built around your goals</h3>
              <p>
                Close to home or anywhere? Maximum yield or maximum income? Self-managed or hands-off?
                A short goal profile re-ranks the country for you, and you can change it any time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Walkthrough ── */}
      <ProductWalkthrough />

      {/* ── Live sample ── */}
      {sample?.card.score && <SampleArea sample={sample} />}

      {/* ── Nationwide pulse (real, national-only figures) ── */}
      {trends && (
        <section className="section-tight mxp-pulse-section">
          <div className="wrap-narrow">
            <div className="eyebrow">Live right now</div>
            <h2>Is the UK market getting stronger?</h2>
            <p className="lede">The explorer watches every analysis run through Stayful. This is the nationwide picture today; members see it area by area.</p>
            <div className="mx mxp-sample"><MarketPulse national={trends.national} /></div>
          </div>
        </section>
      )}

      {/* ── Data & honesty ── */}
      <section className="stats-bar mxp-data">
        <div className="wrap">
          <div className="stats-grid">
            <div className="stat-cell">
              <div className="stat-num">{areaCount ?? "UK"}</div>
              <div className="stat-label">{areaCount ? "Areas tracked" : "Postcode areas"}</div>
              <div className="stat-sub">More appear as reports come in</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">{reportCount ? reportCount.toLocaleString("en-GB") : "Live"}</div>
              <div className="stat-label">Analyser reports pooled</div>
              <div className="stat-sub">Real comparables, not survey guesses</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">{licensingEntries}</div>
              <div className="stat-label">Licensing entries verified</div>
              <div className="stat-sub">Cited sources, per postcode area</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">4</div>
              <div className="stat-label">Score factors, all shown</div>
              <div className="stat-sub">Yield · occupancy · revenue · regulation</div>
            </div>
          </div>
          <div className="data-sources">
            <span className="eyebrow">Honest by design</span>
            <div className="data-source-list mxp-honest">
              Every area carries a confidence tier (Confirmed, Building or Early) based on how many
              reports back it. Thin data is shown as thin data, never dressed up. Figures are area
              averages and indicative, not a guarantee of returns.
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <Pricing signupHref={SIGNUP} />

      {/* ── FAQ ── */}
      <ProductFaq />

      {/* ── Final CTA ── */}
      <section className="final-cta">
        <div className="wrap-narrow">
          <div className="final-cta-card">
            <div className="eyebrow">Start exploring</div>
            <h2>
              Stop guessing where.
              <br />
              <span className="hero-script light">Start knowing.</span>
            </h2>
            <p className="lede">
              Sign up, set your goals in two minutes, and see every UK area ranked for you.
              Free trial, no card required.
            </p>
            <div className="mxp-hero-ctas">
              <Link href={SIGNUP} className="btn btn-light">
                Open the Market Explorer <Icon name="arrow" size={14} />
              </Link>
            </div>
            <div className="final-cta-meta">
              <span><Icon name="check" size={13} /> Free trial · No card</span>
              <span><Icon name="check" size={13} /> £20 of free credit included</span>
              <span><Icon name="check" size={13} /> Cancel any time</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
