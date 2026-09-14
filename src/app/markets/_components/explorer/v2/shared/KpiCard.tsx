import type { ReactNode } from "react";
import { Info } from "lucide-react";

/** A label, a big number and one line under it (a delta tag or a sub line). */
export function KpiCard({
  label,
  value,
  sub,
  info,
  colour,
  size = "lg",
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Tooltip explaining where the number comes from. */
  info?: string;
  colour?: string;
  size?: "lg" | "md";
  className?: string;
}) {
  return (
    <div className={`mx2-card mx2-kpi mx2-kpi--${size} ${className}`}>
      <div className="mx2-kpi-label">
        {label}
        {info && <span className="mx2-info" title={info} aria-label={info}><Info size={13} aria-hidden /></span>}
      </div>
      <div className="mx2-kpi-value" style={colour ? { color: colour } : undefined}>{value}</div>
      {sub !== undefined && sub !== null && <div className="mx2-kpi-sub">{sub}</div>}
    </div>
  );
}
