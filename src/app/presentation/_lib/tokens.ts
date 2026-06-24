// Stayful brand tokens for the presentation (matches #5d8156 brand green and
// the analyser's design language). Self-contained — no Tailwind dependency.

export const C = {
  green: "#5d8156",
  greenDk: "#3a5537",
  greenLt: "#eaf3de",
  greenTx: "#27500a",
  amber: "#ba7517",
  amberLt: "#faeeda",
  amberTx: "#633806",
  red: "#a32d2d",
  redLt: "#fcebeb",
  redTx: "#501313",
  gray900: "#111827",
  gray800: "#1f2937",
  gray500: "#6b7280",
  gray400: "#9ca3af",
  gray300: "#d1d5db",
  gray200: "#e5e7eb",
  gray100: "#f3f4f6",
  gray50: "#f9fafb",
  white: "#ffffff",
} as const;

export const gbp = (n: number): string => `£${Math.round(n).toLocaleString()}`;

type Triple = { fill: string; bg: string; tx: string };

export function riskLevelColors(level: "low" | "moderate" | "high"): Triple {
  if (level === "low") return { fill: C.green, bg: C.greenLt, tx: C.greenTx };
  if (level === "moderate") return { fill: C.amber, bg: C.amberLt, tx: C.amberTx };
  return { fill: C.red, bg: C.redLt, tx: C.redTx };
}

// Risk score (0–100, lower is better).
export function riskScoreColors(score: number): Triple {
  if (score <= 35) return { fill: C.green, bg: C.greenLt, tx: C.greenTx };
  if (score <= 55) return { fill: C.amber, bg: C.amberLt, tx: C.amberTx };
  return { fill: C.red, bg: C.redLt, tx: C.redTx };
}

// Opportunity score (0–100, higher is better) — e.g. direct booking.
export function scoreColors(score: number): Triple {
  if (score >= 70) return { fill: C.green, bg: C.greenLt, tx: C.greenTx };
  if (score >= 50) return { fill: C.amber, bg: C.amberLt, tx: C.amberTx };
  return { fill: C.red, bg: C.redLt, tx: C.redTx };
}

export function riskScoreLabel(score: number): string {
  if (score <= 25) return "Low";
  if (score <= 50) return "Low–medium";
  if (score <= 75) return "Medium–high";
  return "High";
}
