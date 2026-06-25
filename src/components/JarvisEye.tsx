"use client";

import type { JARVISState } from "@/types/jarvis";

interface JarvisEyeProps {
  state: JARVISState;
  size?: number;
}

export function JarvisEye({ state, size = 220 }: JarvisEyeProps) {
  const cx = size / 2;

  const sc =
    ({
      idle:      { c1: "#5d8156", c2: "#7aba6e", glow: "#1a3018", or: "48s", scan: "15s" },
      thinking:  { c1: "#38c4b4", c2: "#7de8dc", glow: "#0d2e28", or: "8s",  scan: "2.2s" },
      speaking:  { c1: "#7aba6e", c2: "#a8e890", glow: "#1a3a1a", or: "22s", scan: "5s"  },
      listening: { c1: "#f4a435", c2: "#f8c868", glow: "#2e1e06", or: "12s", scan: "3.8s" },
    } as const)[state] || { c1: "#5d8156", c2: "#7aba6e", glow: "#1a3018", or: "48s", scan: "15s" };

  const S = (r: number, s: number, e: number) => {
    const x1 = cx + r * Math.cos(s);
    const y1 = cx + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e);
    const y2 = cx + r * Math.sin(e);
    return `M${x1},${y1} A${r},${r} 0 ${e - s > Math.PI ? 1 : 0} 1 ${x2},${y2}`;
  };

  const ticks = Array.from({ length: 64 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    const r1 = size * 0.485;
    const isMaj = i % 8 === 0;
    const isMid = i % 4 === 0;
    const r2 = isMaj ? size * 0.445 : isMid ? size * 0.465 : size * 0.475;
    return {
      x1: cx + r1 * Math.cos(a),
      y1: cx + r1 * Math.sin(a),
      x2: cx + r2 * Math.cos(a),
      y2: cx + r2 * Math.sin(a),
      maj: isMaj,
      mid: isMid,
    };
  });

  const R = size;
  const iris = size * 0.32;
  const pupil = size * 0.112;
  const frame = size * 0.37;
  const outerR = size * 0.478;
  const midR = size * 0.415;
  const scanR = size * 0.447;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div
        style={{
          position: "absolute",
          inset: -50,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${sc.glow}dd 0%, transparent 60%)`,
          animation: `glowBreathe ${
            state === "thinking" ? ".7s" : state === "speaking" ? "1.1s" : "3.5s"
          } ease-in-out infinite`,
          pointerEvents: "none",
        }}
      />

      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} overflow="visible">
        <defs>
          <radialGradient id="ig" cx="50%" cy="44%">
            <stop offset="0%"   stopColor="#000" />
            <stop offset="16%"  stopColor="#070d07" />
            <stop offset="36%"  stopColor="#0e1c0e" />
            <stop offset="58%"  stopColor={sc.c1} stopOpacity=".5" />
            <stop offset="74%"  stopColor={sc.c1} stopOpacity=".88" />
            <stop offset="88%"  stopColor={sc.c1} stopOpacity=".42" />
            <stop offset="100%" stopColor="#080e08" />
          </radialGradient>
          <radialGradient id="pg" cx="34%" cy="34%">
            <stop offset="0%"  stopColor="#3a3a3a" />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>
          <filter id="sg">
            <feGaussianBlur stdDeviation="1.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g style={{ animation: `rotateRing ${sc.or} linear infinite`, transformOrigin: `${cx}px ${cx}px` }}>
          <circle cx={cx} cy={cx} r={outerR} fill="none" stroke={sc.c1} strokeWidth=".6" opacity=".32" />
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke={t.maj ? sc.c2 : sc.c1}
              strokeWidth={t.maj ? 1.8 : t.mid ? 0.9 : 0.55}
              opacity={t.maj ? 0.92 : t.mid ? 0.45 : 0.22}
            />
          ))}
          {[0, 90, 180, 270].map((d) => (
            <path
              key={d}
              d={S(outerR, ((d - 24) * Math.PI) / 180, ((d + 24) * Math.PI) / 180)}
              fill="none"
              stroke={sc.c2}
              strokeWidth="2.8"
              opacity=".88"
            />
          ))}
        </g>

        <g
          style={{
            animation: `rotateCCW ${state === "thinking" ? "5s" : "58s"} linear infinite`,
            transformOrigin: `${cx}px ${cx}px`,
          }}
        >
          <circle cx={cx} cy={cx} r={midR} fill="none" stroke={sc.c1} strokeWidth=".5" strokeDasharray="4 9" opacity=".28" />
          {[45, 135, 225, 315].map((d) => (
            <path
              key={d}
              d={S(midR, ((d - 16) * Math.PI) / 180, ((d + 16) * Math.PI) / 180)}
              fill="none"
              stroke={sc.c1}
              strokeWidth="2.2"
              opacity=".62"
            />
          ))}
        </g>

        <g style={{ animation: `scanArc ${sc.scan} linear infinite`, transformOrigin: `${cx}px ${cx}px` }}>
          <path d={S(scanR, -0.3, 1.1)} fill="none" stroke={sc.c2} strokeWidth="2.2" opacity=".95" filter="url(#sg)" />
          <path d={S(scanR, 1.1, 2.4)} fill="none" stroke={sc.c1} strokeWidth=".8" opacity=".28" />
        </g>

        <circle cx={cx} cy={cx} r={frame} fill="none" stroke={sc.c1} strokeWidth=".9" opacity=".42" />
        {[0, 90, 180, 270].map((d) => {
          const r = Math.PI / 180;
          return (
            <g key={d}>
              <line
                x1={cx + (frame - 0.015 * R) * Math.cos(d * r)}
                y1={cx + (frame - 0.015 * R) * Math.sin(d * r)}
                x2={cx + (frame + 0.06 * R) * Math.cos(d * r)}
                y2={cx + (frame + 0.06 * R) * Math.sin(d * r)}
                stroke={sc.c2}
                strokeWidth="1.4"
                opacity=".65"
              />
            </g>
          );
        })}

        <g
          style={{
            animation:
              state === "speaking"
                ? "irisPulse .85s ease-in-out infinite"
                : state === "listening"
                ? "irisPulse .42s ease-in-out infinite"
                : "none",
            transformOrigin: `${cx}px ${cx}px`,
          }}
        >
          <circle cx={cx} cy={cx} r={iris} fill="url(#ig)" />
          <circle cx={cx} cy={cx} r={iris * 0.9} fill="none" stroke={sc.c1} strokeWidth="1" opacity=".28" />
          <circle cx={cx} cy={cx} r={iris * 0.78} fill="none" stroke={sc.c1} strokeWidth=".5" opacity=".18" />
          {Array.from({ length: 24 }, (_, i) => {
            const a = (i / 24) * Math.PI * 2;
            return (
              <line
                key={i}
                x1={cx + iris * 0.42 * Math.cos(a)}
                y1={cx + iris * 0.42 * Math.sin(a)}
                x2={cx + iris * 0.88 * Math.cos(a)}
                y2={cx + iris * 0.88 * Math.sin(a)}
                stroke={sc.c1}
                strokeWidth=".4"
                opacity=".14"
              />
            );
          })}
        </g>

        <g
          style={{
            animation: state === "thinking" ? "pupilScan 3.8s ease-in-out infinite" : "none",
            transformOrigin: `${cx}px ${cx}px`,
          }}
        >
          <circle cx={cx} cy={cx} r={pupil} fill="url(#pg)" />
          <circle cx={cx - pupil * 0.35} cy={cx - pupil * 0.35} r={pupil * 0.28} fill="white" opacity=".1" />
          <circle cx={cx - pupil * 0.42} cy={cx - pupil * 0.42} r={pupil * 0.12} fill="white" opacity=".42" />
          <circle cx={cx} cy={cx} r={pupil * 0.65} fill="none" stroke={sc.c2} strokeWidth=".5" opacity=".18" />
        </g>

        <circle
          cx={cx}
          cy={cx}
          r={outerR + 4}
          fill="none"
          stroke={sc.c1}
          strokeWidth=".5"
          opacity=".2"
          style={{ animation: `ringPulse ${state !== "idle" ? "1.4s" : "4.5s"} ease-in-out infinite` }}
        />
      </svg>
    </div>
  );
}
