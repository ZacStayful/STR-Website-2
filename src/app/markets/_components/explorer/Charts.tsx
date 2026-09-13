"use client";

import { Bar, BarChart, Cell, LabelList, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { gbpCompact } from "@/lib/market/format";
import type { BedroomStat } from "@/lib/market/explorer";
import { MONTH_SHORT, type Seasonality } from "@/lib/market/seasonality";

const SAGE = "#5d8156";
const SAGE_TRACK = "#e4e7dc";
const AMBER = "#9a7b2e";

/** Single-value meter (0–100). One hue, recessive track, the number in the middle. */
export function Gauge({ value, label, sub, amber = false }: { value: number; label: string; sub: string; amber?: boolean }) {
  const colour = amber ? AMBER : SAGE;
  return (
    <div className="mx-gauge">
      <div className="mx-gauge-chart" aria-label={`${label}: ${value} out of 100`} role="img">
        <ResponsiveContainer width="100%" height={140}>
          <RadialBarChart innerRadius="72%" outerRadius="100%" startAngle={210} endAngle={-30} data={[{ v: value }]} barSize={10}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="v" cornerRadius={6} background={{ fill: SAGE_TRACK }} fill={colour} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="mx-gauge-num"><b>{value}</b><span>/100</span></div>
      </div>
      <div className="mx-gauge-label">{label}</div>
      <div className="mx-gauge-sub">{sub}</div>
    </div>
  );
}

/** Gross revenue by bedroom count, single series, direct-labelled. */
export function BedroomBars({ stats, highlight }: { stats: BedroomStat[]; highlight: number | null }) {
  const data = stats.filter((s) => s.grossRevenue !== null).map((s) => ({ name: `${s.bedrooms}-bed`, bedrooms: s.bedrooms, revenue: s.grossRevenue as number, samples: s.samples }));
  if (data.length === 0) return <p style={{ color: "var(--mx-muted)" }}>No revenue by bedroom yet.</p>;
  return (
    <div className="mx-bars" role="img" aria-label="Average gross revenue by bedroom count">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#7a8274", fontSize: 12 }} />
          <YAxis hide domain={[0, (max: number) => max * 1.15]} />
          <Tooltip
            cursor={{ fill: "rgba(93,129,86,0.08)" }}
            contentStyle={{ borderRadius: 10, border: "1px solid #e4e7dc", fontSize: 12 }}
            formatter={(v) => [gbpCompact(Number(v)), "Avg gross revenue"]}
            labelFormatter={(l, payload) => `${l} · ${payload?.[0]?.payload?.samples ?? 0} samples`}
          />
          <Bar dataKey="revenue" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.bedrooms} fill={highlight === d.bedrooms ? "#2e3d2b" : SAGE} />)}
            <LabelList dataKey="revenue" position="top" formatter={(v) => gbpCompact(Number(v))} style={{ fill: "#4b5346", fontSize: 11, fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Share of the year's revenue by calendar month; the peak month dark, the quietest hollow. */
export function SeasonalityBars({ seasonality }: { seasonality: Seasonality }) {
  const data = seasonality.profile.map((share, i) => ({ name: MONTH_SHORT[i], i, share: Math.round(share * 1000) / 10 }));
  return (
    <div className="mx-bars mx-season-bars" role="img" aria-label="Share of annual revenue by month">
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 18, right: 6, left: 0, bottom: 0 }} barCategoryGap="22%">
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#7a8274", fontSize: 11 }} interval={0} />
          <YAxis hide domain={[0, (max: number) => max * 1.2]} />
          <Tooltip
            cursor={{ fill: "rgba(93,129,86,0.08)" }}
            contentStyle={{ borderRadius: 10, border: "1px solid #e4e7dc", fontSize: 12 }}
            formatter={(v) => [`${Number(v).toFixed(1)}% of annual revenue`, ""]}
            labelFormatter={(l) => String(l)}
          />
          <Bar dataKey="share" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.i} fill={d.i === seasonality.peakMonth ? "#2e3d2b" : d.i === seasonality.lowMonth ? "transparent" : SAGE} stroke={d.i === seasonality.lowMonth ? "#c3d1ab" : "none"} strokeWidth={d.i === seasonality.lowMonth ? 1.5 : 0} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
