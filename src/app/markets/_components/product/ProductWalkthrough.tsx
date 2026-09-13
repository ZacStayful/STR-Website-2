"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icons";
import { MockCardGrid, MockCompare, MockDeals, MockFilterBar, MockGauges, MockGoalChips, MockLevelRow, MockMapPane, MockPerformance, MockTabs, MockTrend } from "./ProductMocks";

interface Step {
  id: string;
  number: string;
  icon: IconName;
  title: string;
  subtitle: string;
  description: string;
  bullets: string[];
  mock: React.ReactNode;
}

const STEPS: Step[] = [
  {
    id: "map",
    number: "01",
    icon: "map",
    title: "See the whole UK, ranked.",
    subtitle: "Every postcode area as a card, and on one map, shaded in four clear bands.",
    description:
      "Start with the map. Every area we hold data for is coloured by its score, your fit, revenue, occupancy, daily rate, yield or competition, in four bands with round-number thresholds, so the strongest markets jump out before you read a single number. Hover a card or an area for the headline, click for the full market page.",
    bullets: ["Colour the map by score, fit, revenue, occupancy, daily rate, yield or competition", "Confidence tiers show how much real data sits behind each area", "Cards beside the map, always in sync; switch to sub-markets for postcode districts"],
    mock: <div className="mxp-mock-split"><MockMapPane compact hoverCard={false} /><div className="mxp-mock-stack"><MockLevelRow /><MockCardGrid rows={2} dense hover="HG" /></div></div>,
  },
  {
    id: "goals",
    number: "02",
    icon: "target",
    title: "Tell it what you're looking for.",
    subtitle: "A two-minute goal profile you can change any time.",
    description:
      "Close to home or anywhere in the UK? Maximum yield or maximum revenue? Self-managed or hands-off? Your answers become a personal 'fit' score that sits beside the Stayful score, so the ranking reflects your plan, not a generic one.",
    bullets: ["Home postcode and how far you'll travel", "Budget bracket and bedroom count", "Priorities: yield, revenue, low competition, direct bookings", "Management style and appetite for licensing rules"],
    mock: <div className="mxp-mock-stack"><MockFilterBar compact /><MockGoalChips /><MockCardGrid rows={2} dense hover={null} /></div>,
  },
  {
    id: "score",
    number: "03",
    icon: "chart",
    title: "A score you can interrogate.",
    subtitle: "Every market gets its own page. Not a black box: we show our working.",
    description:
      "Click any market and it opens as a full page: eleven tabs covering sub-markets, listings, occupancy, revenue, rates, seasonality, competition, licensing, long-let vs short-let and your own deals there. At the top sits a 0–100 market score built from four named factors — yield-on-cost, occupancy, revenue scale and regulatory ease — with the points each one earned, so you can defend the number to a lender, a partner or yourself.",
    bullets: ["Yield-on-cost: revenue against what property actually costs there", "Occupancy: whether the area dependably books", "Regulatory ease: licence required, unrestricted or unconfirmed", "Five signals under the score: licensing, long-let vs short-let, yield, confidence, enquiry trend"],
    mock: <div className="mxp-mock-stack"><MockTabs /><MockPerformance /></div>,
  },
  {
    id: "competition",
    number: "04",
    icon: "eye",
    title: "Know who you're up against.",
    subtitle: "Competition and direct-booking potential, side by side.",
    description:
      "How crowded is the market, and how entrenched are the hosts already in it? We rank every area on listing density and review depth. Then we look at what drives guests to book direct — contractor projects, hospitals, universities and events — so you know where you can build repeat business off-platform.",
    bullets: ["Competition in absolute bands, from the reviews of real comparables", "Direct-booking potential from real local demand drivers", "Licensing rules with cited sources, per area"],
    mock: <MockGauges />,
  },
  {
    id: "compare",
    number: "05",
    icon: "users",
    title: "Compare your shortlist head to head.",
    subtitle: "Tick up to four areas; the dock follows you from the map to each market page.",
    description:
      "Tick the areas you're torn between and compare them line by line: score, your fit, revenue, occupancy, daily rate, yield, competition, licensing and the short-let vs long-let verdict, best value highlighted. Then jump straight into the address analyser for a specific property.",
    bullets: ["Four-way comparison, from the cards or any market page", "Per-bedroom breakdown for every area", "One click into a full property analysis"],
    mock: <MockCompare />,
  },
  {
    id: "listing",
    number: "06",
    icon: "search",
    title: "Paste any listing. Get the answer.",
    subtitle: "Rightmove, OnTheMarket or Airbnb links become deals in seconds.",
    description:
      "Found a flat on Rightmove or a competitor on Airbnb? Paste the link. We read the price, beds and location, show a free quick view — estimated revenue, area score, competition and, for Airbnbs, what that listing actually earns — and run the deal maths: yield on the asking price or the rent-to-rent margin, with the most you could pay. Save it to your pipeline, compare listings side by side, share a deal sheet, and run the full report when you're serious.",
    bullets: ["Free quick view before you spend a report", "Purchase or rent-to-rent maths with a reverse calculator", "Deal pipeline with status, notes and map pins", "Shareable deal sheet for partners, lenders or landlords"],
    mock: <MockDeals />,
  },
  {
    id: "trend",
    number: "07",
    icon: "growth",
    title: "Watch the market move.",
    subtitle: "Is an area getting stronger or weaker? Is the UK?",
    description:
      "Every analysis run through Stayful adds a data point. Each market page carries twelve months of revenue, daily rate and occupancy, and every headline figure says how it moved against the three months before — for each area and for the country as a whole — so you can time a purchase rather than guess.",
    bullets: ["Monthly revenue, daily-rate and occupancy charts per market", "Deltas that name their window: 'vs prior 3 months', never a vague 'past year'", "Honest 'building history' state until an area has enough months"],
    mock: <MockTrend />,
  },
];

export function ProductWalkthrough() {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.idx));
        });
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    refs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <section className="walkthrough mxp-walk" id="how-it-works">
      <div className="wrap">
        <div className="walkthrough-intro">
          <div className="eyebrow">How it works</div>
          <h2>
            Seven views.
            <br />
            One confident decision.
          </h2>
          <p className="lede">
            The Market Explorer turns thousands of real analyser reports into an
            area-by-area picture of the UK short-let market. Here is exactly what
            you get once you&rsquo;re in.
          </p>
        </div>

        <div className="walkthrough-stage">
          <div className="walkthrough-grid">
            <aside className="walkthrough-rail">
              <div className="rail-sticky">
                <div className="rail-track">
                  <div className="rail-progress" style={{ height: ((active + 1) / STEPS.length) * 100 + "%" }} />
                </div>
                <div className="rail-list">
                  {STEPS.map((s, i) => (
                    <a
                      key={s.id}
                      href={"#mx-" + s.id}
                      className={"rail-item" + (active === i ? " active" : "")}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById("mx-" + s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <span className="rail-num">{s.number}</span>
                      <span className="rail-title">{s.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            </aside>

            <div className="walkthrough-content">
              {STEPS.map((s, i) => (
                <article
                  key={s.id}
                  id={"mx-" + s.id}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  data-idx={i}
                  className="walk-section"
                >
                  <div className="walk-text">
                    <div className="walk-num-row">
                      <span className="walk-num">{s.number}</span>
                      <span className="walk-icon"><Icon name={s.icon} size={18} color="var(--sage-600)" /></span>
                    </div>
                    <h3>{s.title}</h3>
                    <p className="walk-sub">{s.subtitle}</p>
                    <p className="walk-desc">{s.description}</p>
                    <ul className="walk-bullets">
                      {s.bullets.map((b) => (
                        <li key={b}><Icon name="check" size={13} color="var(--sage-500)" /> {b}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="walk-mock-wrap">
                    <div className={"section-mock mxp-mock" + (active === i ? " active" : "")}>
                      <div className="section-mock-frame mxp-mock-frame">{s.mock}</div>
                      <div className="section-mock-shadow" aria-hidden />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
