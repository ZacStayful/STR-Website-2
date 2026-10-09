"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import type { JARVISState } from "@/types/jarvis";

/**
 * The Stayful Intelligence eye (Batch 22, Part D): the one drawing behind
 * every eye on the site. Two variants:
 *
 *   narrator      the analyser narrator's eye (JarvisEye wraps it): the full
 *                 eye, its own hex colours per state (teal "thinking"
 *                 included), its 50px glow. Looks exactly as before.
 *   intelligence  Stayful Intelligence: brand colours from the --si-eye-*
 *                 tokens (globals.css, light and dark), the glow scaled with
 *                 the size, and layers that switch on by match-accuracy level:
 *                   0 Waking up             pupil, iris (no fibres), outer circle; dim, slow
 *                   1 Basic                 + the rotating tick ring and its 4 bold arcs, breathing glow
 *                   2 Advanced              + the scanning arc, the counter-rotating dashed ring
 *                                           and its arcs, the frame circle with crosshairs
 *                   3 Stayful Intelligence  + iris fibres, the outer pulse ring, pupil movement
 *                 "Thinking" stays brand green: it shows as speed and brightness.
 *                 Batch 26: it also listens and speaks (the chat's voice), the
 *                 same way: faster, brighter, the iris pulsing. A change of
 *                 state eases the speed over ~0.7s (useEyeEase) instead of
 *                 restarting the animations, so the eye never jumps.
 *
 * Small sizes stay clean: under 48px every 4th tick (16), no iris fibres or
 * inner iris rings, strokes at least 1px; under 32px also no crosshairs and
 * no dashed inner ring (its 4 arcs stay).
 *
 * `powerUp`: a number that changes when a level is reached; each change plays
 * siPowerUp once (≤1 s). Nothing waits for it.
 *
 * SVG ids come from useId, so any number of eyes can share a page. The
 * keyframes are the eye block in globals.css; reduced motion stops them all.
 */

export type EyeLevel = 0 | 1 | 2 | 3;
export type EyeVariant = "narrator" | "intelligence";

interface StayfulEyeProps {
  size?: number;
  variant?: EyeVariant;
  /** Any of the four states (the intelligence eye eases between them). */
  state?: JARVISState;
  level?: EyeLevel;
  powerUp?: number;
  /** A label makes the eye an image for screen readers; without one it is decoration. */
  label?: string;
  className?: string;
}

const NARRATOR = {
  idle: { c1: "#5d8156", c2: "#7aba6e", glow: "#1a3018", or: "48s", scan: "15s" },
  thinking: { c1: "#38c4b4", c2: "#7de8dc", glow: "#0d2e28", or: "8s", scan: "2.2s" },
  speaking: { c1: "#7aba6e", c2: "#a8e890", glow: "#1a3a1a", or: "22s", scan: "5s" },
  listening: { c1: "#f4a435", c2: "#f8c868", glow: "#2e1e06", or: "12s", scan: "3.8s" },
} as const;

const q = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Batch 26: the intelligence eye's speed per state, as a multiple of its idle
 * animation (keyframe name → rate). Its CSS durations never change; these
 * rates are applied with the Web Animations API, which keeps each animation's
 * place, so a ring speeds up from where it is rather than jumping.
 */
const EYE_RATES: Record<JARVISState, Record<string, number>> = {
  idle: { rotateRing: 1, rotateCCW: 1, scanArc: 1, pupilScan: 1, ringPulse: 1, glowBreathe: 1, irisPulse: 0.03 },
  thinking: { rotateRing: 6, rotateCCW: 11.6, scanArc: 6.8, pupilScan: 3.7, ringPulse: 3.2, glowBreathe: 3.9, irisPulse: 0.03 },
  listening: { rotateRing: 4, rotateCCW: 4, scanArc: 4, pupilScan: 1.5, ringPulse: 3.2, glowBreathe: 3, irisPulse: 2.4 },
  speaking: { rotateRing: 2.2, rotateCCW: 2.2, scanArc: 3, pupilScan: 1.5, ringPulse: 3.2, glowBreathe: 3.2, irisPulse: 1.2 },
};
const EASE_MS = 700;

/** Eases every eye animation under `ref` to the state's rates (no-op without the Web Animations API or with reduced motion). */
function useEyeEase(ref: React.RefObject<HTMLDivElement | null>, state: JARVISState, enabled: boolean, layout: string) {
  const shown = useRef<JARVISState | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof el.getAnimations !== "function") return;
    // Ease only a change of state; a first drawing (or a new level or size) starts at its speed.
    const ease = shown.current !== null && shown.current !== state;
    shown.current = state;
    const targets = EYE_RATES[state] ?? EYE_RATES.idle;
    const anims = el
      .getAnimations({ subtree: true })
      .filter((a): a is CSSAnimation => typeof (a as CSSAnimation).animationName === "string" && (a as CSSAnimation).animationName in targets);
    if (!ease) {
      for (const a of anims) a.playbackRate = targets[a.animationName];
      return;
    }
    const from = anims.map((a) => a.playbackRate);
    const start = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / EASE_MS);
      const e = k * k * (3 - 2 * k); // smoothstep
      anims.forEach((a, i) => {
        // Setting playbackRate keeps the animation's current time: no jump.
        a.playbackRate = from[i] + (targets[a.animationName] - from[i]) * e;
      });
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // `layout` re-runs this when the drawing changes (a new level or size brings new animations, at rate 1).
  }, [ref, state, enabled, layout]);
}

export function StayfulEye({ size = 220, variant = "intelligence", state = "idle", level = 3, powerUp, label, className }: StayfulEyeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ig = `ig-${uid}`;
  const pg = `pg-${uid}`;
  const sg = `sg-${uid}`;
  const narrator = variant === "narrator";
  const lv: EyeLevel = narrator ? 3 : level;
  const thinking = state === "thinking";
  const wrap = useRef<HTMLDivElement>(null);
  // The intelligence eye keeps its idle durations and eases its speed between states.
  const eased = !narrator;
  useEyeEase(wrap, state, eased, `${lv}:${size}`);
  const busy = state !== "idle";
  const cx = size / 2;
  const small = !narrator && size < 48;
  const tiny = !narrator && size < 32;
  // Strokes never thinner than 1px on a small eye.
  const w = (n: number) => (small ? Math.max(1, n) : n);

  const sc = narrator
    ? NARRATOR[state] || NARRATOR.idle
    : {
        c1: "var(--si-eye)",
        c2: "var(--si-eye-bright)",
        glow: "var(--si-eye-glow)",
        or: lv === 0 ? "90s" : "48s",
        scan: "15s",
      };
  const glowBg = narrator
    ? `radial-gradient(circle, ${sc.glow}dd 0%, transparent 60%)`
    : `radial-gradient(circle, color-mix(in srgb, ${sc.glow} 87%, transparent) 0%, transparent 60%)`;
  const irisDark = narrator ? ["#000", "#070d07", "#0e1c0e", "#080e08"] : ["var(--si-eye-iris-deep)", "var(--si-eye-iris)", "var(--si-eye-iris)", "var(--si-eye-iris-deep)"];

  // Coordinates rounded to 0.001px: the server's and the browser's Math.cos
  // can differ in the last digit, which React reports as a hydration mismatch.
  const S = (r: number, s: number, e: number) => {
    const x1 = q(cx + r * Math.cos(s));
    const y1 = q(cx + r * Math.sin(s));
    const x2 = q(cx + r * Math.cos(e));
    const y2 = q(cx + r * Math.sin(e));
    return `M${x1},${y1} A${r},${r} 0 ${e - s > Math.PI ? 1 : 0} 1 ${x2},${y2}`;
  };

  const ticks = Array.from({ length: 64 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    const r1 = size * 0.485;
    const isMaj = i % 8 === 0;
    const isMid = i % 4 === 0;
    const r2 = isMaj ? size * 0.445 : isMid ? size * 0.465 : size * 0.475;
    return { i, x1: q(cx + r1 * Math.cos(a)), y1: q(cx + r1 * Math.sin(a)), x2: q(cx + r2 * Math.cos(a)), y2: q(cx + r2 * Math.sin(a)), maj: isMaj, mid: isMid };
  }).filter((t) => !small || t.mid);

  const R = size;
  const iris = size * 0.32;
  const pupil = size * 0.112;
  const frame = size * 0.37;
  const outerR = size * 0.478;
  const midR = size * 0.415;
  const scanR = size * 0.447;

  // The narrator keeps colours as attributes (unchanged markup); the
  // intelligence eye's are CSS variables, which only work as style.
  const stroke = (c: string): { stroke?: string; style?: CSSProperties } => (narrator ? { stroke: c } : { style: { stroke: c } });
  const stop = (c: string, opacity?: string) => (narrator ? { stopColor: c, ...(opacity ? { stopOpacity: opacity } : {}) } : { style: { stopColor: c, ...(opacity ? { stopOpacity: opacity } : {}) } as CSSProperties });

  // Narrator: durations per state, as before. Intelligence: idle durations always (useEyeEase sets the speed).
  const glowSpeed = narrator ? (state === "thinking" ? ".7s" : state === "speaking" ? "1.1s" : "3.5s") : "3.5s";
  const pupilAnim = narrator ? (thinking ? "pupilScan 3.8s ease-in-out infinite" : "none") : lv < 3 ? "none" : "pupilScan 14s ease-in-out infinite";
  const irisAnim = narrator ? (state === "speaking" ? "irisPulse .85s ease-in-out infinite" : state === "listening" ? "irisPulse .42s ease-in-out infinite" : "none") : "irisPulse 1s ease-in-out infinite";

  const wrapStyle: CSSProperties = { position: "relative", width: size, height: size, flexShrink: 0 };
  if (!narrator) {
    if (lv === 0) wrapStyle.opacity = 0.6;
    wrapStyle.filter = busy ? "brightness(1.2)" : "brightness(1)";
    wrapStyle.transition = `filter ${EASE_MS}ms ease`;
  }

  return (
    <div ref={wrap} style={wrapStyle} className={className} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      {lv >= 1 && (
        <div
          style={{
            position: "absolute",
            inset: narrator ? -50 : -Math.round(size * 0.36),
            borderRadius: "50%",
            background: glowBg,
            animation: `glowBreathe ${glowSpeed} ease-in-out infinite`,
            pointerEvents: "none",
          }}
        />
      )}
      {!narrator && powerUp !== undefined && powerUp > 0 && (
        <div
          key={powerUp}
          style={{
            position: "absolute",
            inset: -Math.round(size * 0.12),
            borderRadius: "50%",
            border: `${Math.max(1, Math.round(size / 60))}px solid var(--si-eye-bright)`,
            animation: "siPowerUp .9s ease-out 1 forwards",
            pointerEvents: "none",
            opacity: 0,
          }}
        />
      )}

      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} overflow="visible">
        <defs>
          <radialGradient id={ig} cx="50%" cy="44%">
            <stop offset="0%" {...stop(irisDark[0])} />
            <stop offset="16%" {...stop(irisDark[1])} />
            <stop offset="36%" {...stop(irisDark[2])} />
            <stop offset="58%" {...stop(sc.c1, ".5")} />
            <stop offset="74%" {...stop(sc.c1, ".88")} />
            <stop offset="88%" {...stop(sc.c1, ".42")} />
            <stop offset="100%" {...stop(irisDark[3])} />
          </radialGradient>
          <radialGradient id={pg} cx="34%" cy="34%">
            <stop offset="0%" stopColor="#3a3a3a" />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>
          <filter id={sg}>
            <feGaussianBlur stdDeviation="1.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {lv === 0 && <circle cx={cx} cy={cx} r={outerR} fill="none" {...stroke(sc.c1)} strokeWidth={w(0.6)} opacity=".32" />}

        {lv >= 1 && (
          <g style={{ animation: `rotateRing ${sc.or} linear infinite`, transformOrigin: `${cx}px ${cx}px` }}>
            <circle cx={cx} cy={cx} r={outerR} fill="none" {...stroke(sc.c1)} strokeWidth={w(0.6)} opacity=".32" />
            {ticks.map((t) => (
              <line
                key={t.i}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                {...stroke(t.maj ? sc.c2 : sc.c1)}
                strokeWidth={w(t.maj ? 1.8 : t.mid ? 0.9 : 0.55)}
                opacity={t.maj ? 0.92 : t.mid ? 0.45 : 0.22}
              />
            ))}
            {[0, 90, 180, 270].map((d) => (
              <path key={d} d={S(outerR, ((d - 24) * Math.PI) / 180, ((d + 24) * Math.PI) / 180)} fill="none" {...stroke(sc.c2)} strokeWidth={w(2.8)} opacity=".88" />
            ))}
          </g>
        )}

        {lv >= 2 && (
          <g
            style={{
              animation: `rotateCCW ${narrator && thinking ? "5s" : "58s"} linear infinite`,
              transformOrigin: `${cx}px ${cx}px`,
            }}
          >
            {!tiny && <circle cx={cx} cy={cx} r={midR} fill="none" {...stroke(sc.c1)} strokeWidth={w(0.5)} strokeDasharray="4 9" opacity=".28" />}
            {[45, 135, 225, 315].map((d) => (
              <path key={d} d={S(midR, ((d - 16) * Math.PI) / 180, ((d + 16) * Math.PI) / 180)} fill="none" {...stroke(sc.c1)} strokeWidth={w(2.2)} opacity=".62" />
            ))}
          </g>
        )}

        {lv >= 2 && (
          <g style={{ animation: `scanArc ${sc.scan} linear infinite`, transformOrigin: `${cx}px ${cx}px` }}>
            <path d={S(scanR, -0.3, 1.1)} fill="none" {...stroke(sc.c2)} strokeWidth={w(2.2)} opacity=".95" filter={`url(#${sg})`} />
            <path d={S(scanR, 1.1, 2.4)} fill="none" {...stroke(sc.c1)} strokeWidth={w(0.8)} opacity=".28" />
          </g>
        )}

        {lv >= 2 && <circle cx={cx} cy={cx} r={frame} fill="none" {...stroke(sc.c1)} strokeWidth={w(0.9)} opacity=".42" />}
        {lv >= 2 &&
          !tiny &&
          [0, 90, 180, 270].map((d) => {
            const r = Math.PI / 180;
            return (
              <g key={d}>
                <line
                  x1={q(cx + (frame - 0.015 * R) * Math.cos(d * r))}
                  y1={q(cx + (frame - 0.015 * R) * Math.sin(d * r))}
                  x2={q(cx + (frame + 0.06 * R) * Math.cos(d * r))}
                  y2={q(cx + (frame + 0.06 * R) * Math.sin(d * r))}
                  {...stroke(sc.c2)}
                  strokeWidth={w(1.4)}
                  opacity=".65"
                />
              </g>
            );
          })}

        <g style={{ animation: irisAnim, transformOrigin: `${cx}px ${cx}px` }}>
          <circle cx={cx} cy={cx} r={iris} fill={`url(#${ig})`} />
          {!small && <circle cx={cx} cy={cx} r={iris * 0.9} fill="none" {...stroke(sc.c1)} strokeWidth="1" opacity=".28" />}
          {!small && <circle cx={cx} cy={cx} r={iris * 0.78} fill="none" {...stroke(sc.c1)} strokeWidth=".5" opacity=".18" />}
          {lv >= 3 &&
            !small &&
            Array.from({ length: 24 }, (_, i) => {
              const a = (i / 24) * Math.PI * 2;
              return (
                <line
                  key={i}
                  x1={q(cx + iris * 0.42 * Math.cos(a))}
                  y1={q(cx + iris * 0.42 * Math.sin(a))}
                  x2={q(cx + iris * 0.88 * Math.cos(a))}
                  y2={q(cx + iris * 0.88 * Math.sin(a))}
                  {...stroke(sc.c1)}
                  strokeWidth=".4"
                  opacity=".14"
                />
              );
            })}
        </g>

        <g style={{ animation: pupilAnim, transformOrigin: `${cx}px ${cx}px` }}>
          <circle cx={cx} cy={cx} r={pupil} fill={`url(#${pg})`} />
          <circle cx={cx - pupil * 0.35} cy={cx - pupil * 0.35} r={pupil * 0.28} fill="white" opacity=".1" />
          <circle cx={cx - pupil * 0.42} cy={cx - pupil * 0.42} r={pupil * 0.12} fill="white" opacity=".42" />
          {!small && <circle cx={cx} cy={cx} r={pupil * 0.65} fill="none" {...stroke(sc.c2)} strokeWidth=".5" opacity=".18" />}
        </g>

        {lv >= 3 && (
          <circle
            cx={cx}
            cy={cx}
            r={outerR + 4}
            fill="none"
            stroke={narrator ? sc.c1 : undefined}
            strokeWidth={w(0.5)}
            opacity=".2"
            style={{ ...(narrator ? {} : { stroke: sc.c1 }), animation: `ringPulse ${narrator ? (state !== "idle" ? "1.4s" : "4.5s") : "4.5s"} ease-in-out infinite` }}
          />
        )}
      </svg>
    </div>
  );
}
