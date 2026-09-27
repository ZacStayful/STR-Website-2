'use client';

import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendPanel, TrendPoint } from '@/lib/activity/view';

/**
 * The weekly-active trend: one small chart per group, each against its own
 * target, all on the same 0–100% scale so they compare at a glance. One
 * series per chart, so the title names it and no legend is needed.
 *
 * Only weeks with live tracking are plotted. The weeks before it are shaded:
 * their figures come from the backfill, which undercounts, and drawing them
 * on the same line would show a jump at the release that never happened.
 * The tables under the charts carry every figure, those weeks included, and
 * are this chart's table view.
 *
 * Colours are the site's own tokens (as in ../churn/ChurnCharts.tsx), so
 * light and dark are each chosen in globals.css.
 */

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 } as const;
const TOOLTIP_STYLE = { borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)' } as const;

function TrendTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const p = payload?.[0]?.payload as TrendPoint | undefined;
  if (!active || !p) return null;
  const note = p.tracked === 'none' ? 'Before live tracking: see the table' : p.tracked === 'partial' ? 'Live tracking started this week' : p.current ? 'This week so far' : null;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2">
      <div className="text-sm font-semibold text-foreground">{p.pct === null ? '—' : `${p.pct}%`}</div>
      <div className="text-xs text-muted-foreground">
        {p.active} of {p.base} · week of {p.label}
      </div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function Panel({ panel }: { panel: TrendPanel }) {
  const { points } = panel;
  const firstLive = points.findIndex((p) => p.tracked !== 'none');
  // Shade from the first week up to where the line starts.
  const shade = firstLive > 0 ? { x1: points[0].label, x2: points[firstLive].label } : null;
  const latest = [...points].reverse().find((p) => p.pct !== null) ?? null;

  return (
    <figure className="rounded-xl border border-border bg-card p-4">
      <figcaption>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-foreground">{panel.title}</span>
          <span className="text-xs text-muted-foreground">target {panel.target}%</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {latest ? (
            <>
              {latest.current ? 'This week so far' : `Week of ${latest.label}`}: <span className="font-semibold text-foreground">{latest.pct}%</span> ({latest.active} of {latest.base})
            </>
          ) : (
            'Nothing to plot yet'
          )}
        </div>
      </figcaption>
      <div className="mt-3 h-48" role="img" aria-label={`${panel.title}: the share active each week, against a target of ${panel.target}%. Every figure is in the tables below.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
            {shade && (
              <ReferenceArea
                x1={shade.x1}
                x2={shade.x2}
                fill="var(--muted)"
                fillOpacity={0.6}
                stroke="none"
                label={{ value: 'Before live tracking', position: 'insideTopLeft', fill: 'var(--muted-foreground)', fontSize: 10 }}
              />
            )}
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
            <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} unit="%" />
            <ReferenceLine
              y={panel.target}
              stroke="var(--foreground)"
              strokeOpacity={0.5}
              strokeWidth={1}
              label={{ value: `Target ${panel.target}%`, position: 'insideTopRight', fill: 'var(--muted-foreground)', fontSize: 10 }}
            />
            <Tooltip cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }} content={(p) => <TrendTooltip active={p.active} payload={p.payload} />} />
            <Line
              type="linear"
              dataKey="pct"
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 4, fill: 'var(--chart-1)', stroke: 'var(--card)', strokeWidth: 2 }}
              activeDot={{ r: 5, fill: 'var(--chart-1)', stroke: 'var(--card)', strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function WeeklyActiveTrend({ panels }: { panels: TrendPanel[] }) {
  if (!panels.some((panel) => panel.points.some((p) => p.pct !== null))) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border px-6 text-center text-sm text-muted-foreground">
        The trend starts with the first week of live tracking. Until then every figure is backfilled history, in the tables below.
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {panels.map((panel) => (
        <Panel key={panel.title} panel={panel} />
      ))}
    </div>
  );
}
