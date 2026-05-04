// B3 — Demand-driver constellation.
// A central property pin with radial connectors to nearby demand sources
// (university, hospital, train, venue, airport). Communicates "the software
// knows why bookings happen here, not just that they do."
import type { ReactNode } from "react";

const DRIVERS: Array<{ id: string; label: string; distance: string; angle: number; icon: ReactNode }> = [
  {
    id: "university",
    label: "University",
    distance: "1.7 mi",
    angle: -90,
    icon: (
      <path d="M12 3l9 5-9 5-9-5 9-5zm0 9.5L20 8v7l-8 4-8-4V8l8 4.5z" />
    ),
  },
  {
    id: "hospital",
    label: "Hospital",
    distance: "2.0 mi",
    angle: -36,
    icon: (
      <path d="M11 6h2v4h4v2h-4v4h-2v-4H7v-2h4V6zM4 4h16v16H4V4z" />
    ),
  },
  {
    id: "station",
    label: "Train station",
    distance: "0.7 mi",
    angle: 36,
    icon: (
      <path d="M5 11h14V8a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v3zm0 2v3a3 3 0 0 0 3 3l-2 3h2l2-3h4l2 3h2l-2-3a3 3 0 0 0 3-3v-3H5zm3 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm8 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
    ),
  },
  {
    id: "venue",
    label: "Venue / events",
    distance: "0.8 mi",
    angle: 108,
    icon: (
      <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-1 5h2v5l4 2-1 1.7-5-3V8z" />
    ),
  },
  {
    id: "airport",
    label: "Airport",
    distance: "14.5 mi",
    angle: -150,
    icon: (
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1L15 22v-1.5L13 19v-5.5L21 16z" />
    ),
  },
];

export function DemandConstellation() {
  const cx = 300;
  const cy = 220;
  const r = 145;

  return (
    <div className="sf-constellation">
      <svg viewBox="0 0 600 440" role="img" aria-label="Demand drivers around a sample property">
        <defs>
          <radialGradient id="sf-cgrad" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="rgba(93,129,86,0.20)" />
            <stop offset="100%" stopColor="rgba(93,129,86,0)" />
          </radialGradient>
        </defs>

        {/* halo */}
        <circle cx={cx} cy={cy} r={r + 40} fill="url(#sf-cgrad)" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(93,129,86,0.20)" strokeDasharray="3 5" />

        {/* connectors */}
        {DRIVERS.map((d) => {
          const a = (d.angle * Math.PI) / 180;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          return (
            <line
              key={`${d.id}-line`}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="rgba(93,129,86,0.40)"
              strokeWidth={1.5}
            />
          );
        })}

        {/* outer nodes */}
        {DRIVERS.map((d) => {
          const a = (d.angle * Math.PI) / 180;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          return (
            <g key={d.id}>
              <circle cx={x} cy={y} r={28} fill="#ffffff" stroke="#5d8156" strokeWidth={2} />
              <g transform={`translate(${x - 12}, ${y - 12})`} fill="#5d8156">
                <svg viewBox="0 0 24 24" width={24} height={24}>
                  {d.icon}
                </svg>
              </g>
              <text
                x={x}
                y={y + 50}
                fontSize="13"
                fontWeight="700"
                fill="#4a6944"
                textAnchor="middle"
                fontFamily="system-ui, sans-serif"
              >
                {d.label}
              </text>
              <text
                x={x}
                y={y + 66}
                fontSize="11"
                fontWeight="600"
                fill="#5d8156"
                textAnchor="middle"
                fontFamily="system-ui, sans-serif"
                opacity={0.7}
              >
                {d.distance}
              </text>
            </g>
          );
        })}

        {/* central node */}
        <circle cx={cx} cy={cy} r={36} fill="#5d8156" />
        <circle cx={cx} cy={cy} r={36} fill="none" stroke="rgba(93,129,86,0.40)" strokeWidth={8} />
        <text
          x={cx}
          y={cy + 5}
          fontSize="13"
          fontWeight="700"
          fill="#ffffff"
          textAnchor="middle"
          fontFamily="system-ui, sans-serif"
          letterSpacing="0.04em"
        >
          YOUR PROPERTY
        </text>
      </svg>
    </div>
  );
}
