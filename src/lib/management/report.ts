/**
 * Batch 22f: the admin's management-company funnel, from rows already read:
 * page views → sign-ups → paid → live → first real lead, leads a month,
 * median minutes from sign-up to live, and revenue by tier. Pure.
 */
import { tierFor, type FunnelTier } from '../funnels/tiers.ts';

export interface McAccount {
  id: string;
  email: string | null;
  createdAt: string;
  stampedAt: string | null;
  via: string | null;
  packPaid: boolean;
  firstLiveAt: string | null;
  chargedLeads: number;
}

export interface McCharge {
  month: string;
  n: number | null;
  basePence: number | null;
}

export interface McReport {
  pageViews: number;
  taggedViews: number;
  signups: number;
  paid: number;
  live: number;
  firstLead: number;
  medianMinutesToLive: number | null;
  byVia: Record<string, number>;
  leadsByMonth: Array<{ month: string; leads: number; pence: number }>;
  revenueByTier: Array<{ from: number; leads: number; pence: number }>;
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mcReport(input: { views: Array<{ views: number; tagged: number }>; accounts: McAccount[]; charges: McCharge[]; tiers: FunnelTier[] }): McReport {
  const a = input.accounts;
  const minutes = a
    .filter((x) => x.firstLiveAt)
    .map((x) => (Date.parse(x.firstLiveAt!) - Date.parse(x.createdAt)) / 60_000)
    .filter((m) => Number.isFinite(m) && m >= 0);
  const byVia: Record<string, number> = {};
  for (const x of a) byVia[x.via ?? 'unknown'] = (byVia[x.via ?? 'unknown'] ?? 0) + 1;

  const months = new Map<string, { leads: number; pence: number }>();
  const tiers = new Map<number, { leads: number; pence: number }>();
  for (const c of input.charges) {
    const m = months.get(c.month) ?? { leads: 0, pence: 0 };
    m.leads += 1;
    m.pence += Number(c.basePence) || 0;
    months.set(c.month, m);
    if (c.n) {
      const t = tierFor(c.n, input.tiers).from;
      const r = tiers.get(t) ?? { leads: 0, pence: 0 };
      r.leads += 1;
      r.pence += Number(c.basePence) || 0;
      tiers.set(t, r);
    }
  }
  return {
    pageViews: input.views.reduce((s, v) => s + (Number(v.views) || 0), 0),
    taggedViews: input.views.reduce((s, v) => s + (Number(v.tagged) || 0), 0),
    signups: a.length,
    paid: a.filter((x) => x.packPaid).length,
    live: a.filter((x) => x.firstLiveAt).length,
    firstLead: a.filter((x) => x.chargedLeads > 0).length,
    medianMinutesToLive: (() => {
      const m = median(minutes);
      return m === null ? null : Math.round(m);
    })(),
    byVia,
    leadsByMonth: [...months.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1)).map(([month, v]) => ({ month, ...v })),
    revenueByTier: input.tiers.map((t) => ({ from: t.from, ...(tiers.get(t.from) ?? { leads: 0, pence: 0 }) })),
  };
}
