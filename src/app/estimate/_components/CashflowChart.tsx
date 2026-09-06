'use client';

import { useMemo } from 'react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { monthlyCashflow } from '@/lib/listing/deal';
import { gbp } from './format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Twelve months of net cashflow against the fixed outgoing (rent or mortgage). */
export function CashflowChart({ monthlyRevenue, fixedPcm, fixedLabel }: { monthlyRevenue: number[]; fixedPcm: number; fixedLabel: string }) {
  const rows = useMemo(() => monthlyCashflow(monthlyRevenue, fixedPcm), [monthlyRevenue, fixedPcm]);
  const under = rows.filter((r) => r.underwater).length;
  const data = rows.map((r) => ({ name: MONTHS[r.month - 1], net: r.net, revenue: r.revenue }));
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">Monthly cashflow after {fixedLabel}</p>
            <p className="text-xs text-muted-foreground">Net of platform, management, cleaning and bills, minus {gbp(fixedPcm)} a month.</p>
          </div>
          <p className={`text-xs font-semibold ${under === 0 ? 'text-success' : 'text-destructive'}`}>{under === 0 ? 'Positive every month' : `${under} month${under === 1 ? '' : 's'} underwater`}</p>
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `£${Math.round(v / 100) / 10}k`} width={44} />
              <Tooltip formatter={(v) => gbp(Number(Array.isArray(v) ? v[0] : v ?? 0))} labelClassName="text-xs" />
              <ReferenceLine y={0} stroke="#9a7b2e" strokeDasharray="3 3" />
              <Bar dataKey="net" name="Net cashflow" radius={[4, 4, 0, 0]}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.net < 0 ? '#c0392b' : '#5d8156'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
