"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";

interface Chapter {
  num: string;
  title: string;
  t: number;
}

const CHAPTERS: Chapter[] = [
  { num: "01", title: "Property intake", t: 0 },
  { num: "02", title: "Live data ingest", t: 16 },
  { num: "03", title: "Decision overview", t: 34 },
  { num: "04", title: "Comparables", t: 50 },
  { num: "05", title: "Amenities & demand", t: 76 },
  { num: "06", title: "Revenue breakdown", t: 86 },
  { num: "07", title: "12-month forecast", t: 94 },
  { num: "08", title: "Local area report", t: 102 },
  { num: "09", title: "Setup costs", t: 56 },
  { num: "10", title: "Risk assessment", t: 108 },
];

const SPEED_OPTIONS = [1, 1.5, 2];

const fmt = (s: number) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
};

export function VideoTour() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(122);
  const [speed, setSpeed] = useState(1.5);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
  }, [speed]);

  const onTime = () => {
    const v = videoRef.current;
    if (!v) return;
    setTime(v.currentTime);
    const sorted = CHAPTERS.map((c, i) => ({ ...c, i })).sort((a, b) => a.t - b.t);
    let idx = 0;
    for (const c of sorted) if (v.currentTime >= c.t) idx = c.i;
    setActive(idx);
  };

  const seekTo = (target: number, andPlay = true) => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.currentTime = target;
    } catch {}
    if (andPlay) {
      v.playbackRate = speed;
      v.play()
        .then(() => setPlaying(true))
        .catch(() => {});
    }
  };

  const jump = (i: number) => {
    setActive(i);
    seekTo(CHAPTERS[i].t, true);
  };

  const seekBar = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width)
    );
    seekTo(pct * (v.duration || duration), !v.paused);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
    if (v.paused) {
      v.play()
        .then(() => setPlaying(true))
        .catch(() => {});
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const cycleSpeed = () => {
    const next =
      SPEED_OPTIONS[(SPEED_OPTIONS.indexOf(speed) + 1) % SPEED_OPTIONS.length];
    setSpeed(next);
  };

  const progress = (time / duration) * 100;

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
            report.
          </p>
        </div>

        <div className="vt-frame">
          <div className="vt-player-col">
            <div className="vt-player">
              <video
                ref={videoRef}
                src="/assets/analyser-walkthrough.mp4"
                onTimeUpdate={onTime}
                onLoadedMetadata={(e) =>
                  setDuration((e.target as HTMLVideoElement).duration)
                }
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                playsInline
                preload="metadata"
              />
              {!playing && (
                <button
                  className="vt-big-play"
                  onClick={togglePlay}
                  aria-label="Play"
                >
                  <Icon name="play" size={28} color="var(--sage-800)" />
                </button>
              )}
            </div>
            <div className="vt-controls">
              <button
                className="vt-play"
                onClick={togglePlay}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <rect x="6" y="5" width="4" height="14" rx="1" />
                    <rect x="14" y="5" width="4" height="14" rx="1" />
                  </svg>
                ) : (
                  <Icon name="play" size={13} color="currentColor" />
                )}
              </button>
              <span className="vt-time">
                {fmt(time)}{" "}
                <span className="vt-time-sep">/</span> {fmt(duration)}
              </span>
              <div className="vt-bar" onClick={seekBar}>
                <div
                  className="vt-bar-fill"
                  style={{ width: progress + "%" }}
                />
                {CHAPTERS.map((c, i) => (
                  <button
                    key={i}
                    className={"vt-bar-marker" + (active === i ? " active" : "")}
                    style={{ left: (c.t / duration) * 100 + "%" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      jump(i);
                    }}
                    aria-label={`Jump to ${c.title}`}
                  />
                ))}
              </div>
              <button
                className="vt-speed"
                onClick={cycleSpeed}
                aria-label="Playback speed"
              >
                {speed}×
              </button>
              <span className="vt-active-chip">
                {CHAPTERS[active].num} · {CHAPTERS[active].title}
              </span>
            </div>
          </div>

          <div className="vt-chapters">
            <div className="vt-chap-h">
              <span className="eyebrow">Chapters</span>
              <span className="muted" style={{ fontSize: 12 }}>
                11 · {fmt(duration)}
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
