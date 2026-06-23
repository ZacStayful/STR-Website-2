// Stayful brand tokens for the STR Intelligence Report. Kept as plain hex so
// the experience is fully self-contained and independent of the global
// Tailwind theme (which this route deliberately does not touch).

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

export type RiskRating = "Low" | "Moderate" | "High";

export function ratingColors(rating: RiskRating): { fill: string; bg: string; tx: string } {
  if (rating === "Low") return { fill: C.green, bg: C.greenLt, tx: C.greenTx };
  if (rating === "Moderate") return { fill: C.amber, bg: C.amberLt, tx: C.amberTx };
  return { fill: C.red, bg: C.redLt, tx: C.redTx };
}

export const gbp = (n: number): string => `£${Math.round(n).toLocaleString()}`;
