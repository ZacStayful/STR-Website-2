"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icons";
import { MockCompare, MockGauges, MockGoalChips, MockMapPane, MockRankedList, MockScoreTable, MockTrend } from "./ProductMocks";

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
    subtitle: "Every postcode area on one map, shaded by what matters to you.",
    description:
      "Start with the map. Every area we hold data for is coloured by its score, yield, occupancy or revenue, so the strongest markets jump out before you read a single number. Hover for the headline, click for the full picture.",
    bullets: ["Colour the map by score, yield, occupancy or revenue", "Confidence tiers show how much real data sits behind each area", "Ranked list beside the map, always in sync"],
    mock: <div className="mxp-mock-split"><MockMapPane compact /><MockRankedList rows={5} dense /></div>,
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
    mock: <div className="mxp-mock-stack"><MockGoalChips /><MockRankedList rows={4} dense /></div>,
  },
  {
    id: "score",
    number: "03",
    icon: "chart",
    title: "A score you can interrogate.",
    subtitle: "Not a black box. We show our working on every area.",
    description:
      "Each area gets a 0–100 Stayful score built from four named factors: yield-on-cost, occupancy, revenue scale and regulatory ease. You see the raw figure behind every factor and the points it earned, so you can defend the number to a lender, a partner or yourself.",
    bullets: ["Yield-on-cost: revenue against what property actually costs there", "Occupancy: whether the area dependably books", "Regulatory ease: licence required, unrestricted or unconfirmed"],
    mock: <MockScoreTable />,
  },
  {
    id: "competition",
    number: "04",
    icon: "eye",
    title: "Know who you're up against.",
    subtitle: "Competition and direct-booking potential, side by side.",
    description:
      "How crowded is the market, and how entrenched are the hosts already in it? We rank every area on listing density and review depth. Then we look at what drives guests to book direct — contractor projects, hospitals, universities and events — so you know where you can build repeat business off-platform.",
    bullets: ["Competition ranked relative to every other UK area", "Direct-booking potential from real local demand drivers", "Licensing rules with cited sources, per area"],
    mock: <MockGauges />,
  },
  {
    id: "compare",
    number: "05",
    icon: "users",
    title: "Compare your shortlist head to head.",
    subtitle: "Up to four areas in one table, best value highlighted.",
    description:
      "Pin the areas you're torn between and compare them line by line: score, revenue, occupancy, yield, competition, licensing and the short-let vs long-let verdict. Then jump straight into the address analyser for a specific property.",
    bullets: ["Four-way comparison table", "Per-bedroom breakdown for every area", "One click into a full property analysis"],
    mock: <MockCompare />,
  },
  {
    id: "trend",
    number: "06",
    icon: "growth",
    title: "Watch the market move.",
    subtitle: "Is an area getting stronger or weaker? Is the UK?",
    description:
      "Every analysis run through Stayful adds a data point. Over time the explorer shows whether enquiries, rates and occupancy are rising or falling — for each area and for the country as a whole — so you can time a purchase rather than guess.",
    bullets: ["Monthly enquiry, ADR and occupancy series per area", "Nationwide market pulse", "Honest 'building history' state until an area has enough months"],
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
            Six views.
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
