import type { ReactNode } from "react";

const R = 20;
const C = 2 * Math.PI * R;

/**
 * The 0–100 ring from the design (48px card, 40px popover, 96px hero). A null
 * value draws the track only with "—" in the middle, or whatever `empty`
 * provides (the "Set goals" button on the fit ring).
 */
export function ScoreRing({
  value,
  size = 48,
  colour = "var(--mx-sage-deep)",
  label,
  empty,
  className = "",
}: {
  value: number | null;
  size?: number;
  colour?: string;
  /** Accessible name, e.g. "Market score 74 out of 100". */
  label: string;
  empty?: ReactNode;
  className?: string;
}) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const fontSize = Math.round(size * 0.31);
  return (
    <div className={`mx2-ring ${className}`} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={R} fill="none" stroke="var(--mx-line)" strokeWidth="4" />
        {value !== null && <circle cx="24" cy="24" r={R} fill="none" stroke={colour} strokeWidth="4" strokeDasharray={`${(v / 100) * C} ${C}`} transform="rotate(-90 24 24)" />}
      </svg>
      <span className="mx2-ring-num" style={{ fontSize }}>{value === null ? empty ?? "—" : Math.round(value)}</span>
    </div>
  );
}
