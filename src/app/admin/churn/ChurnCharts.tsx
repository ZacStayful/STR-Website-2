'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TENURE_BANDS, type TrendPoint } from '@/lib/billing/churn';

/**
 * The trend charts.
 *
 * Client islands inside the server-rendered page, following
 * src/app/estimate/_components/CashflowChart.tsx. Colours come from the
 * --tenure-* custom properties rather than hard-coded hex so light and dark are
 * each chosen in globals.css instead of one being an automatic flip of the
 * other.
 */

const BAND_FILL: Record<string, string> = {
  '0-1': 'var(--tenure-1)',
  '1-3': 'var(--tenure-2)',
  '3-6': 'var(--tenure-3)',
  '6-12': 'var(--tenure-4)',
  '12+': 'var(--tenure-5)',
};

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 } as const;
const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  fontSize: 12,
} as const;

function gbp(pence: number): string {
  return `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function EmptyPlot({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Monthly revenue stacked by how long the customer has been paying.
 *
 * The point of the chart is watching revenue climb into the darker, longer-
 * tenured bands. Segments carry a 2px surface-coloured stroke so adjacent
 * bands of one hue stay separable, and the band table under it is the
 * non-colour reading of the same numbers.
 */
export function StabilityTrend({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <EmptyPlot>Revenue by tenure appears here once a subscription has been recorded.</EmptyPlot>;
  }

  const data = points.map((p) => ({
    label: p.label,
    ...Object.fromEntries(TENURE_BANDS.map((b) => [b.key, (p.byBand[b.key] ?? 0) / 100])),
  }));

  return (
    <div className="h-64" role="img" aria-label="Monthly subscription revenue, stacked by how long each customer has been paying">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => `£${v}`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v) => `£${Number(Array.isArray(v) ? v[0] : (v ?? 0)).toFixed(2)}`}
          />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {TENURE_BANDS.map((band) => (
            <Area
              key={band.key}
              type="monotone"
              dataKey={band.key}
              name={band.label}
              stackId="mrr"
              stroke="var(--card)"
              strokeWidth={2}
              fill={BAND_FILL[band.key]}
              fillOpacity={1}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Subscribers and the churn rate, month by month.
 *
 * Two measures on one axis would be a lie — a headcount and a percentage do not
 * share a scale — so they are two stacked charts sharing an x-axis instead.
 */
export function ChurnTrend({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <EmptyPlot>The churn trend appears here once subscriptions start and end.</EmptyPlot>;
  }

  const data = points.map((p) => ({
    label: p.label,
    active: p.active,
    churned: p.churned,
    started: p.started,
    churnRate: p.churnRatePct,
  }));

  return (
    <div className="space-y-4">
      <div className="h-48" role="img" aria-label="Active subscribers, started and churned, by month">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Line type="monotone" dataKey="active" name="Active" stroke="var(--tenure-3)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="started" name="Started" stroke="var(--chart-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="churned" name="Churned" stroke="var(--destructive)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="h-40" role="img" aria-label="Monthly churn rate as a percentage of those active when the month began">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} unit="%" />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => `${Number(Array.isArray(v) ? v[0] : (v ?? 0))}%`} />
            <Line
              type="monotone"
              dataKey="churnRate"
              name="Churn rate"
              stroke="var(--destructive)"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        Churn rate is those who left in the month over those active when it began. A month with nobody
        active at the start has no rate rather than a zero.
      </p>
    </div>
  );
}

/** How long converting members took, as a histogram. */
export function ConversionHistogram({ buckets }: { buckets: { key: string; label: string; members: number }[] }) {
  const total = buckets.reduce((n, b) => n + b.members, 0);
  if (total === 0) {
    return <EmptyPlot>No member has topped up yet, so there is no time-to-convert to plot.</EmptyPlot>;
  }
  const max = Math.max(...buckets.map((b) => b.members));
  return (
    <ul className="space-y-2">
      {buckets.map((b) => (
        <li key={b.key} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-muted-foreground">{b.label}</span>
          <span className="h-3 flex-1 rounded bg-muted">
            <span
              className="block h-3 rounded"
              style={{ width: `${max > 0 ? Math.round((b.members / max) * 100) : 0}%`, background: 'var(--tenure-3)' }}
            />
          </span>
          <span className="w-8 text-right tabular-nums">{b.members}</span>
        </li>
      ))}
    </ul>
  );
}

export { gbp };
