"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";
import { SECTIONS } from "@/lib/sections-data";
import { SectionMock } from "./SectionMock";

export function Walkthrough() {
  const [active, setActive] = useState(0);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const idx = Number((e.target as HTMLElement).dataset.idx);
            setActive(idx);
          }
        });
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    sectionRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const handleRailClick = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById("sec-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="walkthrough" id="features">
      <div className="wrap">
        <div className="walkthrough-intro">
          <div className="eyebrow">The full report</div>
          <h2>
            Eleven sections.
            <br />
            One decision.
          </h2>
          <p className="lede">
            Every analysis runs the same 11 modules — from address intake to a
            ranked growth playbook. Each module is a piece of evidence.
            Together, they&rsquo;re a defensible answer to{" "}
            <em>should I do this?</em>
          </p>
        </div>
      </div>

      <div className="walkthrough-stage">
        <div className="walkthrough-grid wrap">
          <aside className="walkthrough-rail">
            <div className="rail-sticky">
              <div className="rail-progress">
                <div
                  className="rail-progress-fill"
                  style={{
                    height: ((active + 1) / SECTIONS.length) * 100 + "%",
                  }}
                />
              </div>
              <div className="rail-list">
                {SECTIONS.map((s, i) => (
                  <a
                    key={s.id}
                    href={"#sec-" + s.id}
                    className={"rail-item" + (active === i ? " active" : "")}
                    onClick={handleRailClick(s.id)}
                  >
                    <span className="rail-num">{s.number}</span>
                    <span className="rail-title">{s.title}</span>
                  </a>
                ))}
              </div>
            </div>
          </aside>

          <div className="walkthrough-content">
            {SECTIONS.map((s, i) => (
              <article
                key={s.id}
                id={"sec-" + s.id}
                ref={(el) => {
                  sectionRefs.current[i] = el;
                }}
                data-idx={i}
                className="walk-section"
              >
                <div className="walk-text">
                  <div className="walk-num-row">
                    <span className="walk-num">{s.number}</span>
                    <span className="walk-icon">
                      <Icon name={s.icon} size={18} color="var(--sage-600)" />
                    </span>
                  </div>
                  <h3>{s.title}</h3>
                  <p className="walk-sub">{s.subtitle}</p>
                  <p className="walk-desc">{s.description}</p>
                  <ul className="walk-bullets">
                    {s.bullets.map((b) => (
                      <li key={b}>
                        <Icon
                          name="check"
                          size={13}
                          color="var(--sage-500)"
                        />{" "}
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="walk-mock-wrap">
                  <SectionMock id={s.id} active={active === i} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
