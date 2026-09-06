"use client";

import { Bar, BarChart, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AreaTrend } from "@/lib/market/trend";
import { formatMonth, type TrendResult } from "@/lib/market/trend";
import { gbp } from "@/lib/market/format";

const SAGE = "#5d8156";
const INK = "#2e3d2b";
const THIN = "#c3d1ab";
const MIN = 3;

function Arrow({ t, label, fmt }: { t: TrendResult; label: string; fmt: (v: number) => string }) {
  if (t.direction === "insufficient") return <div className="mx-trend-kpi"><b>—</b><span>{label}</span><small>Building history</small></div>;
  const pct = t.deltaPct === null ? "" : `${t.deltaPct > 0 ? "+" : ""}${Math.round(t.deltaPct * 100)}%`;
  return (
    <div className={`mx-trend-kpi mx-trend-kpi--${t.direction}`}>
      <b>{t.recent === null ? "—" : fmt(t.recent)}</b>
      <span>{label}</span>
      <small>{t.direction === "flat" ? "steady" : pct} vs prior {t.priorMonths} mo</small>
    </div>
  );
}

/** Enquiries as bars, ADR / occupancy / revenue as lines; thin months hollow and excluded from the arrows. */
export function TrendCharts({ trend, name }: { trend: AreaTrend; name: string }) {
  const data = trend.series.map((b) => ({
    month: formatMonth(b.month).split(" ")[0],
    key: b.month,
    reports: b.reports,
    thin: b.reports < MIN,
    adr: b.reports >= MIN ? b.avg_adr : null,
    occ: b.reports >= MIN ? b.avg_occupancy : null,
    rev: b.reports >= MIN ? b.avg_gross_revenue : null,
  }));
  const tip = { borderRadius: 10, border: "1px solid #e4e7dc", fontSize: 12 };
  return (
    <div className="mx-panel">
      <h2>Trend</h2>
      <p style={{ color: "var(--mx-muted)" }}>
        Every analysis run through Stayful is a data point. {trend.since ? `Tracking ${name} since ${formatMonth(trend.since)}.` : "No reports in this window yet."}
      </p>
      <div className="mx-trend-kpis">
        <Arrow t={trend.enquiries} label={`enquiries / ${trend.enquiries.recentMonths || 3} mo`} fmt={(v) => String(Math.round(v))} />
        <Arrow t={trend.adr} label="ADR" fmt={(v) => gbp(v)} />
        <Arrow t={trend.occupancy} label="occupancy" fmt={(v) => `${Math.round(v)}%`} />
        <Arrow t={trend.revenue} label="avg revenue" fmt={(v) => gbp(v)} />
      </div>

      <div className="mx-trend-chart" role="img" aria-label={`Monthly enquiries for ${name}`}>
        <div className="mx-trend-chart-title">Enquiries per month</div>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barCategoryGap="30%">
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#7a8274", fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis hide allowDecimals={false} />
            <Tooltip cursor={{ fill: "rgba(93,129,86,0.08)" }} contentStyle={tip} formatter={(v) => [String(v), "Reports"]} labelFormatter={(_, p) => formatMonth(String(p?.[0]?.payload?.key ?? ""))} />
            <Bar dataKey="reports" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.key} fill={d.thin ? "transparent" : SAGE} stroke={d.thin ? THIN : SAGE} strokeWidth={d.thin ? 1.5 : 0} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {(["adr", "occ", "rev"] as const).map((k) => {
        const label = k === "adr" ? "Average daily rate" : k === "occ" ? "Occupancy" : "Average gross revenue";
        const fmt = (v: number) => (k === "occ" ? `${Math.round(v)}%` : gbp(v));
        if (!data.some((d) => d[k] !== null)) return null;
        return (
          <div className="mx-trend-chart" key={k} role="img" aria-label={`${label} by month for ${name}`}>
            <div className="mx-trend-chart-title">{label}</div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#7a8274", fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip contentStyle={tip} formatter={(v) => [fmt(Number(v)), label]} labelFormatter={(_, p) => formatMonth(String(p?.[0]?.payload?.key ?? ""))} />
                <Line type="monotone" dataKey={k} stroke={INK} strokeWidth={2} dot={{ r: 3, fill: INK, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}
      <p className="mx-disclaimer" style={{ marginTop: 10 }}>Months with fewer than {MIN} reports are drawn hollow and excluded from the trend arrows; the current month is shown but not counted until it is complete.</p>
    </div>
  );
}
