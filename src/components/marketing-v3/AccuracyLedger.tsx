"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ACCURACY_WINDOW,
  CASE_STUDIES,
  FORECAST_WINDOW,
  accuracySummary,
  formatMetric,
  formatVariance,
  variance,
} from "@/lib/case-studies-data";

// The answer to the objection the whole category runs into: can these
// numbers be trusted? Every figure here is derived from CASE_STUDIES by
// accuracySummary(), so the headline and the rows cannot drift apart, and
// the two claims in the copy are asserted in case-studies-data.test.ts.

const [OWNER_NET, OCCUPANCY] = accuracySummary();

const WORST_OCCUPANCY = Math.max(
  ...CASE_STUDIES.map((s) => Math.abs(variance("occupancy", s.metrics.occupancy))),
);

export function AccuracyLedger({
  variant = "summary",
}: {
  variant?: "summary" | "full";
}) {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
          }
        });
      },
      { rootMargin: "0px 0px -15% 0px", threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section className="acc section" id="accuracy">
      <div className="wrap-narrow">
        <div className="acc-head">
          <div className="eyebrow">Forecast vs actual</div>
          <h2>
            Here&rsquo;s what we forecast.
            <br />
            Here&rsquo;s what actually happened.
          </h2>
          <p className="lede">
            Six properties Stayful took under management in 2025. For each, the
            Income Estimate we produced <em>before</em> it went live, next to
            twelve months of real bookings. No retro-fitting, no cherry-picked
            month.
          </p>
        </div>

        <div className="acc-claims">
          <div className="acc-claim">
            <span className="acc-claim-num">
              {OWNER_NET.aboveForecast} of {OWNER_NET.n}
            </span>
            <span className="acc-claim-label">
              properties earned more for the owner than we forecast
            </span>
          </div>
          <div className="acc-claim">
            <span className="acc-claim-num">
              {WORST_OCCUPANCY.toFixed(1)} pts
            </span>
            <span className="acc-claim-label">
              the largest occupancy miss across the six
            </span>
          </div>
        </div>

        <div
          ref={tableRef}
          className={"acc-table" + (visible ? " is-visible" : "")}
        >
          <div className="acc-row acc-row-head">
            <div className="acc-cell acc-cell-prop">Property</div>
            <div className="acc-cell">Forecast net</div>
            <div className="acc-cell">Actual net</div>
            <div className="acc-cell">Variance</div>
            <div className="acc-cell">Occupancy</div>
          </div>
          {CASE_STUDIES.map((s, i) => {
            const net = s.metrics.ownerNet;
            const occ = s.metrics.occupancy;
            const occUnder = variance("occupancy", occ) < 0;
            return (
              <div
                key={s.id}
                className="acc-row"
                style={{ "--i": i } as React.CSSProperties}
              >
                <div className="acc-cell acc-cell-prop">
                  <span className="acc-prop-name">{s.title}</span>
                  <span className="acc-prop-meta">
                    {s.city} · {s.meta}
                  </span>
                </div>
                <div className="acc-cell" data-label="Forecast net">
                  {formatMetric("ownerNet", net.forecast)}
                </div>
                <div className="acc-cell" data-label="Actual net">
                  {formatMetric("ownerNet", net.actual)}
                </div>
                <div className="acc-cell acc-cell-var" data-label="Variance">
                  {formatVariance("ownerNet", net)}
                </div>
                <div
                  className={
                    "acc-cell acc-cell-var" + (occUnder ? " is-under" : "")
                  }
                  data-label="Occupancy"
                >
                  {formatVariance("occupancy", occ)}
                </div>
              </div>
            );
          })}
        </div>

        <p className="acc-foot">
          n = {OWNER_NET.n} · Forecasts produced pre-onboarding,{" "}
          {FORECAST_WINDOW} · Actuals from Airbnb host dashboards and Stayful
          direct bookings, {ACCURACY_WINDOW} · Owner net is after platform
          fees, cleaning and management · Occupancy variance is in percentage
          points. Six properties is a small sample, and past results are not a
          forecast.
        </p>

        <div className="acc-ctas">
          <a className="btn btn-primary" href="#reports">
            Open the six case studies
          </a>
          <Link className="btn btn-ghost" href="/methodology">
            How we work it out
          </Link>
        </div>

        {variant === "full" && (
          <div className="acc-note">
            <h3>Where our model is wrong, and why</h3>
            <p>
              Occupancy runs slightly high. On five of the six, the property
              was occupied a little less than we projected — by{" "}
              {Math.abs(OCCUPANCY.meanVariance).toFixed(1)} points on average.
              We would rather show that than round it away.
            </p>
            <p>
              Nightly rate is a harder problem, and it is the reason ADR is not
              in the table above. Our forecast quotes a rate per booked night;
              the figure that comes back off a host dashboard at year end is
              built on a different denominator, so putting the two side by side
              would imply a gap that is partly definitional rather than a real
              miss. Until we can publish both on identical terms, showing them
              as a like-for-like comparison would be misleading, so we don&rsquo;t.
              Owner net — the number a purchase decision actually turns on — is
              measured the same way on both sides, and that is what the ledger
              reports.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
