import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";
import { pulse, formatMonth, type TrendResult } from "@/lib/market/trend";
import type { MonthBucket } from "@/lib/market/types";
import { gbp } from "@/lib/market/format";

function Dir({ t }: { t: TrendResult }) {
  if (t.direction === "insufficient") return <span className="mx-pulse-dir mx-pulse-dir--building">building</span>;
  const Icon = t.direction === "up" ? TrendingUp : t.direction === "down" ? TrendingDown : Minus;
  const pct = t.deltaPct === null ? "" : `${t.deltaPct > 0 ? "+" : ""}${Math.round(t.deltaPct * 100)}%`;
  return <span className={`mx-pulse-dir mx-pulse-dir--${t.direction}`}><Icon size={13} aria-hidden /> {t.direction === "flat" ? "steady" : pct}</span>;
}

/**
 * Nationwide market pulse: enquiry volume, ADR and occupancy direction from
 * live analyser reports. Server-renderable; used in the explorer, the public
 * product page and the homepage.
 */
export function MarketPulse({ national, compact = false }: { national: MonthBucket[] | null | undefined; compact?: boolean }) {
  const p = national ? pulse(national) : null;
  if (!p) return null;
  const lastMonthKey = national![national!.length - 2]?.month;
  return (
    <div className={"mx-pulse" + (compact ? " mx-pulse--compact" : "")} role="status" aria-label="UK market pulse">
      <span className="mx-pulse-title"><Activity size={14} aria-hidden /> UK market pulse</span>
      <span className="mx-pulse-item"><b>{p.lastMonth}</b> enquiries in {lastMonthKey ? formatMonth(lastMonthKey) : "the last month"} <Dir t={p.enquiries} /></span>
      <span className="mx-pulse-item"><b>{p.thisMonth}</b> so far this month</span>
      <span className="mx-pulse-item">ADR <b>{p.latestAdr === null ? "—" : gbp(p.latestAdr)}</b> <Dir t={p.adr} /></span>
      <span className="mx-pulse-item">Occupancy <b>{p.latestOccupancy === null ? "—" : `${Math.round(p.latestOccupancy)}%`}</b> <Dir t={p.occupancy} /></span>
      {p.since && <span className="mx-pulse-since">Tracking since {formatMonth(p.since)}</span>}
    </div>
  );
}
