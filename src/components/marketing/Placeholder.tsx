import type { CSSProperties } from "react";

type Props = {
  width: number;
  height: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
  rounded?: boolean;
};

// Sage gradient placeholder rendered as inline SVG.
// Keeps layout pixel-stable while real photography is still being generated.
// Once a photo lands in the IMG manifest, the parent component swaps to <Image>.
export function Placeholder({
  width,
  height,
  label,
  className,
  style,
  rounded = true,
}: Props) {
  const id = `phg-${Math.round(width)}x${Math.round(height)}`;
  const radius = rounded ? 12 : 0;
  return (
    <svg
      role="img"
      aria-label={label ?? "Image placeholder"}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      style={{ display: "block", borderRadius: radius, ...style }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#BAD6C7" />
          <stop offset="50%" stopColor="#a8c9b8" />
          <stop offset="100%" stopColor="#9bbfa9" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.4" r="0.7">
          <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill={`url(#${id})`} rx={radius} ry={radius} />
      <rect width={width} height={height} fill={`url(#${id}-glow)`} rx={radius} ry={radius} />
      {label ? (
        <text
          x="50%"
          y="50%"
          fontFamily="system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
          fontSize={Math.max(14, Math.min(width, height) * 0.025)}
          fontWeight="600"
          fill="rgba(74, 105, 68, 0.55)"
          dominantBaseline="middle"
          textAnchor="middle"
          letterSpacing="0.04em"
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
}
