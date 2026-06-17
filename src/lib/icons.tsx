// Inline-SVG icon set ported from the Claude Design handoff (icons.jsx).
// Outlined sage-style strokes at 1.6px on a 24px viewBox, currentColor by default.

import * as React from "react";

export type IconName =
  | "search"
  | "loading"
  | "overview"
  | "comparables"
  | "amenities"
  | "revenue"
  | "forecast"
  | "local"
  | "setup"
  | "risk"
  | "growth"
  | "arrow"
  | "check"
  | "minus"
  | "star"
  | "pin"
  | "bed"
  | "users"
  | "bath"
  | "car"
  | "palm"
  | "download"
  | "file"
  | "calendar"
  | "spark"
  | "target"
  | "shield"
  | "rocket"
  | "chevron"
  | "play"
  | "chart"
  | "map"
  | "quote"
  | "plus"
  | "zap"
  | "eye"
  | "sparkles";

export interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  color?: string;
  className?: string;
  "aria-hidden"?: boolean;
}

export function Icon({
  name,
  size = 20,
  stroke = 1.6,
  color = "currentColor",
  className,
  "aria-hidden": ariaHidden = true,
}: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": ariaHidden,
  };

  switch (name) {
    case "search":
      return <svg {...common}><circle cx="11" cy="11" r="6" /><path d="M20 20l-3.5-3.5" /></svg>;
    case "loading":
      return <svg {...common}><path d="M12 3a9 9 0 0 1 9 9" /><path d="M3 12a9 9 0 0 0 9 9" opacity=".35" /></svg>;
    case "overview":
      return <svg {...common}><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-7h-4v7H5a1 1 0 0 1-1-1z" /></svg>;
    case "comparables":
      return <svg {...common}><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18M9 6V3M15 6V3" /></svg>;
    case "amenities":
      return <svg {...common}><path d="M5 21V9l7-5 7 5v12" /><path d="M9 21v-6h6v6" /></svg>;
    case "revenue":
      return <svg {...common}><path d="M4 19V5M4 19l5-5 4 4 7-9" /><path d="M16 9h4v4" /></svg>;
    case "forecast":
      return <svg {...common}><path d="M3 18l5-7 4 4 5-8 4 6" /><path d="M3 21h18" opacity=".4" /></svg>;
    case "local":
      return <svg {...common}><path d="M12 21s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>;
    case "setup":
      return <svg {...common}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></svg>;
    case "risk":
      return <svg {...common}><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17v.01" /></svg>;
    case "growth":
      return <svg {...common}><path d="M5 15l4-4 3 3 7-7" /><path d="M14 7h6v6" /></svg>;
    case "arrow":
      return <svg {...common}><path d="M5 12h14M13 5l7 7-7 7" /></svg>;
    case "check":
      return <svg {...common}><path d="M5 12l4 4 10-10" /></svg>;
    case "minus":
      return <svg {...common}><path d="M5 12h14" /></svg>;
    case "star":
      return <svg {...common}><path d="M12 3l2.5 5.5L20 9.5l-4 4 1 5.5L12 16.5 7 19l1-5.5-4-4 5.5-1z" /></svg>;
    case "pin":
      return <svg {...common}><circle cx="12" cy="11" r="3" /><path d="M12 21s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z" /></svg>;
    case "bed":
      return <svg {...common}><path d="M3 18V8M3 18h18M3 18v2M21 18v2M3 14h18v4" /><path d="M7 14V11a2 2 0 0 1 2-2h10v5" /></svg>;
    case "users":
      return <svg {...common}><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0 1 14 0" /><path d="M16 11a3 3 0 0 0 0-6" /><path d="M22 20a7 7 0 0 0-5-6.7" /></svg>;
    case "bath":
      return <svg {...common}><path d="M3 11h18v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" /><path d="M6 11V6a2 2 0 0 1 4 0" /><path d="M5 18l-1 3M19 18l1 3" /></svg>;
    case "car":
      return <svg {...common}><path d="M5 17h14M6 17l1.5-5h9L18 17M5 17v3M19 17v3" /><circle cx="8" cy="14" r="1" /><circle cx="16" cy="14" r="1" /></svg>;
    case "palm":
      return <svg {...common}><path d="M12 22V10" /><path d="M12 10c-3-2-6-1-8 1M12 10c3-2 6-1 8 1M12 10c0-3 2-5 5-5M12 10c0-3-2-5-5-5" /></svg>;
    case "download":
      return <svg {...common}><path d="M12 4v12M6 12l6 4 6-4" /><path d="M5 20h14" /></svg>;
    case "file":
      return <svg {...common}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>;
    case "calendar":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>;
    case "spark":
      return <svg {...common}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M18.5 5.5l-2.8 2.8M8.3 15.7l-2.8 2.8" /></svg>;
    case "target":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill={color} /></svg>;
    case "shield":
      return <svg {...common}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg>;
    case "rocket":
      return <svg {...common}><path d="M12 2c4 3 6 7 6 11l-3 3h-6l-3-3c0-4 2-8 6-11z" /><circle cx="12" cy="10" r="1.5" /><path d="M9 17l-2 4M15 17l2 4" /></svg>;
    case "chevron":
      return <svg {...common}><path d="M9 6l6 6-6 6" /></svg>;
    case "play":
      return <svg {...common}><path d="M7 4l13 8-13 8z" /></svg>;
    case "chart":
      return <svg {...common}><path d="M4 20V4M4 20h16" /><rect x="7" y="13" width="2.5" height="5" fill={color} /><rect x="11.5" y="9" width="2.5" height="9" fill={color} /><rect x="16" y="6" width="2.5" height="12" fill={color} /></svg>;
    case "map":
      return <svg {...common}><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v16M15 6v16" /></svg>;
    case "quote":
      return <svg {...common}><path d="M7 7h4v4l-2 6H5l2-6V7zM15 7h4v4l-2 6h-4l2-6V7z" fill={color} stroke="none" /></svg>;
    case "plus":
      return <svg {...common}><path d="M5 12h14M12 5v14" /></svg>;
    case "zap":
      return <svg {...common}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></svg>;
    case "eye":
      return <svg {...common}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>;
    case "sparkles":
      return <svg {...common}><path d="M12 3l1.8 4.5L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.5z" /><path d="M19 14l1 2.5 2.5 1L20 18.5 19 21l-1-2.5L15.5 17.5 18 16.5z" /></svg>;
    default:
      return null;
  }
}
