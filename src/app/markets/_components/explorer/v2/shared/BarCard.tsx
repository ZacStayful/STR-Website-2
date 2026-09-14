"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface BarDatum {
  label: string;
  value: number;
  /** Peak is ink, low is hollow, the rest sage. */
  tone?: "peak" | "low" | "thin";
}

/** The design's bar chart card: single series, direct value labels, the peak bar in ink. */
export function BarCard({ title, data, format, tag, ariaLabel, height = 170, className = "", note }: { title: ReactNode; data: BarDatum[]; format: (v: number) => string; tag?: ReactNode; ariaLabel: string; height?: number; className?: string; note?: ReactNode }) {
  return (
    <div className={`mx2-card mx2-chart ${className}`}>
      <div className="mx2-chart-head"><h4 className="mx2-h4">{title}</h4>{tag}</div>
      <div className="mx2-chart-body" role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 20, right: 6, left: 6, bottom: 0 }} barCategoryGap="24%">
            <XAxis dataKey="label" axisLine={{ stroke: "#2e3d2b", strokeWidth: 2 }} tickLine={false} tick={{ fill: "#7a8274", fontSize: 11 }} interval={0} />
            <YAxis hide domain={[0, (max: number) => max * 1.18]} />
            <Tooltip cursor={{ fill: "rgba(93,129,86,0.08)" }} contentStyle={{ borderRadius: 10, border: "1px solid #e4e7dc", fontSize: 12 }} formatter={(v) => [format(Number(v)), ""]} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.label} fill={d.tone === "peak" ? "#2e3d2b" : d.tone === "low" || d.tone === "thin" ? "transparent" : "#5d8156"} stroke={d.tone === "low" || d.tone === "thin" ? "#c3d1ab" : "none"} strokeWidth={d.tone === "low" || d.tone === "thin" ? 1.5 : 0} />
              ))}
              <LabelList dataKey="value" position="top" formatter={(v) => format(Number(v))} style={{ fill: "#4b5346", fontSize: 11, fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {note && <p className="mx2-note">{note}</p>}
    </div>
  );
}
