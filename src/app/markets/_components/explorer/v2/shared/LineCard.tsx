"use client";

import type { ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMonth } from "@/lib/market/trend";
import type { MonthBucket } from "@/lib/market/types";

export type LineMetric = "avg_gross_revenue" | "avg_adr" | "avg_occupancy";

/** A month with fewer reports than this is drawn as a gap: its average is one or two properties, not a market. */
export const MIN_REPORTS = 3;

/**
 * One of the design's monthly line charts, over the explorer's 12-month
 * report-activity series. Thin months are gaps, the footer carries the low
 * and high, and the whole card can open its tab.
 */
export function LineCard({
  title,
  series,
  metric,
  format,
  tag,
  legend,
  onClick,
  minReports = MIN_REPORTS,
  height = 160,
  className = "",
}: {
  title: ReactNode;
  series: MonthBucket[];
  metric: LineMetric;
  format: (v: number) => string;
  tag?: ReactNode;
  legend?: string;
  onClick?: () => void;
  minReports?: number;
  height?: number;
  className?: string;
}) {
  const data = series.map((b) => ({ key: b.month, month: formatMonth(b.month).split(" ")[0], v: b.reports >= minReports ? b[metric] : null, reports: b.reports }));
  const vals = data.map((d) => d.v).filter((v): v is number => v !== null && v !== undefined);
  const usable = vals.length;
  const min = usable ? Math.min(...vals) : null;
  const max = usable ? Math.max(...vals) : null;
  const titleText = typeof title === "string" ? title : "chart";
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper type={onClick ? "button" : undefined} className={`mx2-card mx2-chart ${onClick ? "is-clickable" : ""} ${className}`} onClick={onClick}>
      <div className="mx2-chart-head"><h4 className="mx2-h4">{title}</h4>{tag}</div>
      {usable >= 2 ? (
        <>
          <div className="mx2-chart-body" role="img" aria-label={`${titleText} by month`}>
            <ResponsiveContainer width="100%" height={height}>
              <LineChart data={data} margin={{ top: 8, right: 10, left: 10, bottom: 0 }}>
                <XAxis dataKey="month" axisLine={{ stroke: "#2e3d2b", strokeWidth: 2 }} tickLine={false} tick={{ fill: "#7a8274", fontSize: 11 }} interval={0} />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e4e7dc", fontSize: 12 }} formatter={(v) => [format(Number(v)), legend ?? titleText]} labelFormatter={(_, p) => `${formatMonth(String(p?.[0]?.payload?.key ?? ""))} · ${p?.[0]?.payload?.reports ?? 0} reports`} />
                <Line type="monotone" dataKey="v" stroke="#5d8156" strokeWidth={3} dot={{ r: 3, fill: "#5d8156", strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mx2-chart-foot"><span>Low {format(min!)}</span><span>High {format(max!)}</span></div>
          {legend && <div className="mx2-chart-legend"><span className="mx2-swatch" />{legend}</div>}
        </>
      ) : (
        <p className="mx2-note">Building history: {usable} month{usable === 1 ? "" : "s"} with {minReports}+ reports so far. Every analyser report run here adds a point.</p>
      )}
    </Wrapper>
  );
}
