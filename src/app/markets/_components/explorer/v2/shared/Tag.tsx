import type { ReactNode } from "react";
import { deltaTag } from "@/lib/market/delta";
import type { TrendResult } from "@/lib/market/trend";

export type TagTone = "accent" | "up" | "down" | "amber" | "neutral" | "info";

export function Tag({ tone = "neutral", children, title, className = "" }: { tone?: TagTone; children: ReactNode; title?: string; className?: string }) {
  return <span className={`mx2-tag mx2-tag--${tone} ${className}`} title={title}>{children}</span>;
}

/**
 * "+8% vs prior 3 mo" next to a KPI. `goodWhen` says which direction to colour
 * green: revenue rising is good, competition rising is not.
 */
export function DeltaTag({ trend, goodWhen = "up", title }: { trend: TrendResult | null | undefined; goodWhen?: "up" | "down"; title?: string }) {
  const d = deltaTag(trend);
  const tone: TagTone = d.tone === "neutral" ? "neutral" : d.tone === goodWhen ? "up" : "down";
  return <Tag tone={tone} title={title ?? (d.tone === "neutral" ? "Fewer than two full months on each side of the comparison" : "Last full months against the ones before; not year-on-year")}>{d.text}</Tag>;
}
