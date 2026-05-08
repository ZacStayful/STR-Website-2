"use client";

import { useState } from "react";
import { Icon } from "@/lib/icons";

// 11 chapters mirror the Drive design's video walkthrough.
// Day 1: render with a poster + functional chapter list (clicking a chapter
// scrolls the page to /#features anchor or the matching section). Once a
// Mux/Cloudflare Stream playback URL is provided, swap the player block.

interface Chapter {
  num: string;
  title: string;
  t: number;
  end: number;
  sectionId: string;
}

const CHAPTERS: Chapter[] = [
  { num: "01", title: "Property intake", t: 0, end: 16, sectionId: "intake" },
  { num: "02", title: "Live data ingest", t: 16, end: 34, sectionId: "loading" },
  { num: "03", title: "Decision overview", t: 34, end: 50, sectionId: "overview" },
  { num: "04", title: "Comparables", t: 50, end: 76, sectionId: "comparables" },
  { num: "05", title: "Amenities & demand", t: 76, end: 86, sectionId: "amenities" },
  { num: "06", title: "Revenue breakdown", t: 86, end: 94, sectionId: "revenue" },
  { num: "07", title: "12-month forecast", t: 94, end: 102, sectionId: "forecast" },
  { num: "08", title: "Local area report", t: 102, end: 108, sectionId: "local" },
  { num: "09", title: "Setup costs", t: 56, end: 76, sectionId: "bookings" },
  { num: "10", title: "Risk assessment", t: 108, end: 116, sectionId: "risk" },
  { num: "11", title: "Growth playbook", t: 116, end: 122, sectionId: "growth" },
];

const DURATION = 122;
const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
};

export function VideoTour() {
  const [active, setActive] = useState(0);

  const jump = (i: number) => {
    setActive(i);
    document
      .getElementById("sec-" + CHAPTERS[i].sectionId)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="video-tour section" id="watch">
      <div className="wrap">
        <div className="vt-head">
          <div className="eyebrow">Watch a real run</div>
          <h2>
            Two minutes.
            <br />
            Eleven sections.
            <br />
            One real York property.
          </h2>
          <p className="lede">
            A live recording of the Property Analyser running 17 Park Crescent,
            York, end-to-end. Click any chapter to jump to that part of the
            report below.
          </p>
        </div>

        <div className="vt-frame">
          <div className="vt-player-col">
            <div className="vt-player">
              <div className="vt-player-poster">
                <button
                  className="vt-big-play"
                  onClick={() => jump(0)}
                  aria-label="Play walkthrough"
                >
                  <Icon name="play" size={28} color="var(--sage-800)" />
                </button>
                <span>Walkthrough video coming soon</span>
              </div>
            </div>
            <div className="vt-controls">
              <button className="vt-play" aria-label="Play">
                <Icon name="play" size={13} color="currentColor" />
              </button>
              <span className="vt-time">
                0:00 <span className="vt-time-sep">/</span> {fmt(DURATION)}
              </span>
              <div className="vt-bar">
                <div className="vt-bar-fill" style={{ width: "0%" }} />
                {CHAPTERS.map((c, i) => (
                  <button
                    key={i}
                    className={"vt-bar-marker" + (active === i ? " active" : "")}
                    style={{ left: (c.t / DURATION) * 100 + "%" }}
                    onClick={() => jump(i)}
                    aria-label={`Jump to ${c.title}`}
                  />
                ))}
              </div>
              <button className="vt-speed">1×</button>
              <span className="vt-active-chip">
                {CHAPTERS[active].num} · {CHAPTERS[active].title}
              </span>
            </div>
          </div>

          <div className="vt-chapters">
            <div className="vt-chap-h">
              <span className="eyebrow">Chapters</span>
              <span className="muted" style={{ fontSize: 12 }}>
                11 · {fmt(DURATION)}
              </span>
            </div>
            <div className="vt-chap-list">
              {CHAPTERS.map((c, i) => (
                <button
                  key={i}
                  className={"vt-chap" + (active === i ? " active" : "")}
                  onClick={() => jump(i)}
                >
                  <div className="vt-chap-thumb">
                    <span className="vt-chap-num">{c.num}</span>
                  </div>
                  <div className="vt-chap-meta">
                    <div className="vt-chap-title">{c.title}</div>
                    <div className="vt-chap-time">{fmt(c.t)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
