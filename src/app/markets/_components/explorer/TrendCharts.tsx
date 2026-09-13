"use client";

import { Bar, BarChart, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RATING_FLOOR, RATING_GOOD, REVIEW_THRESHOLD } from "@/lib/market/competition";
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
    rated: b.rated_reports ?? 0,
    reviews: (b.rated_reports ?? 0) >= MIN ? b.avg_review_count ?? null : null,
    rating: (b.rated_reports ?? 0) >= MIN ? b.avg_rating ?? null : null,
  }));
  const hasCompetition = data.some((d) => d.reviews !== null || d.rating !== null);
  const axis = { axisLine: false, tickLine: false, tick: { fill: "#7a8274", fontSize: 11 }, interval: "preserveStartEnd" as const };
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
      <div className="mx-trend-chart-title" style={{ marginTop: 14, fontSize: "0.86rem" }}>Competition over time</div>
      <p style={{ color: "var(--mx-muted)", marginTop: 2 }}>The average review count and rating of the comparables analysed by the reports run in each month. {REVIEW_THRESHOLD}+ reviews is an established market; {RATING_GOOD}★ and above with fewer reviews is an opportunity.</p>
      {hasCompetition ? (
        <>
          <div className="mx-trend-kpis">
            <Arrow t={trend.reviews} label="avg reviews" fmt={(v) => String(Math.round(v))} />
            <Arrow t={trend.rating} label="avg rating" fmt={(v) => `${v.toFixed(2)}★`} />
          </div>
          <div className="mx-trend-chart" role="img" aria-label={`Average review count of comparables by month for ${name}`}>
            <div className="mx-trend-chart-title">Average reviews per comparable</div>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" {...axis} />
                <YAxis hide domain={[0, (max: number) => Math.max(max * 1.15, REVIEW_THRESHOLD * 1.15)]} />
                <ReferenceLine y={REVIEW_THRESHOLD} stroke="#9a7b2e" strokeDasharray="4 3" label={{ value: `${REVIEW_THRESHOLD} reviews`, position: "insideTopRight", fill: "#9a7b2e", fontSize: 10 }} />
                <Tooltip contentStyle={tip} formatter={(v) => [String(Math.round(Number(v))), "Avg reviews"]} labelFormatter={(_, p) => formatMonth(String(p?.[0]?.payload?.key ?? ""))} />
                <Line type="monotone" dataKey="reviews" stroke={INK} strokeWidth={2} dot={{ r: 3, fill: INK, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mx-trend-chart" role="img" aria-label={`Average rating of comparables by month for ${name}`}>
            <div className="mx-trend-chart-title">Average rating</div>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" {...axis} />
                <YAxis hide domain={[4.2, 5]} />
                <ReferenceLine y={RATING_GOOD} stroke="#3f7a4a" strokeDasharray="4 3" label={{ value: `${RATING_GOOD}★`, position: "insideTopRight", fill: "#3f7a4a", fontSize: 10 }} />
                <ReferenceLine y={RATING_FLOOR} stroke="#b3452f" strokeDasharray="4 3" label={{ value: `${RATING_FLOOR}★`, position: "insideBottomRight", fill: "#b3452f", fontSize: 10 }} />
                <Tooltip contentStyle={tip} formatter={(v) => [`${Number(v).toFixed(2)}★`, "Avg rating"]} labelFormatter={(_, p) => formatMonth(String(p?.[0]?.payload?.key ?? ""))} />
                <Line type="monotone" dataKey="rating" stroke={INK} strokeWidth={2} dot={{ r: 3, fill: INK, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <p className="mx-muted-p">No month yet has {MIN} reports with review data; the competition lines appear as reports come in.</p>
      )}
      <p className="mx-disclaimer" style={{ marginTop: 10 }}>Months with fewer than {MIN} reports are drawn hollow and excluded from the trend arrows; the current month is shown but not counted until it is complete.</p>
    </div>
  );
}
