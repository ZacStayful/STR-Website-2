/**
 * Synthetic report comparables shaped like a real Airbtics `report/all`
 * payload (Manchester, Sep 2026): monthly histories from 2021-01, the 2021
 * lockdown lows, a null-gapped comp, newcomers and a part-year listing.
 */

import type { CompHistory, MonthlyDict } from '../months.ts';

export const SEASON = [0.8, 0.8, 0.9, 1.0, 1.05, 1.15, 1.25, 1.25, 1.1, 1.0, 0.85, 0.95];

export interface FixtureComp extends CompHistory {
  id: string;
}

/** Builds a comp from 2021-01 to `lastKey`, growing `growth` a year from `base` a month. */
export function makeComp(id: string, opts: {
  base?: number;
  growth?: number;
  start?: string;
  lastKey?: string;
  nullKeys?: string[];
  activeDays?: number;
  stay?: number;
  occupancy?: number;
} = {}): FixtureComp {
  const base = opts.base ?? 1500;
  const growth = opts.growth ?? 0.1;
  const [sy, sm] = (opts.start ?? '2021-01').split('-').map(Number);
  const [ly, lm] = (opts.lastKey ?? '2026-09').split('-').map(Number);
  const revenue: MonthlyDict = {};
  const occ: MonthlyDict = {};
  const adr: MonthlyDict = {};
  const bookings: MonthlyDict = {};
  const occupancy = opts.occupancy ?? 70;
  const stay = opts.stay ?? 3;
  for (let i = sy * 12 + sm - 1; i <= ly * 12 + lm - 1; i++) {
    const y = Math.floor(i / 12);
    const m = i - y * 12;
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    if (opts.nullKeys?.includes(key)) {
      revenue[key] = null; occ[key] = null; adr[key] = null; bookings[key] = null;
      continue;
    }
    const lockdown = y === 2021 && m < 4 ? 0.2 : 1;
    const years = (i - (2025 * 12 + 8)) / 12; // 1.0 at 2025-09 → 2026-08 midpoint-ish
    const level = base * SEASON[m] * lockdown * Math.pow(1 + growth, years);
    revenue[key] = Math.round(level);
    const o = Math.min(100, occupancy * SEASON[m] * lockdown);
    occ[key] = Math.round(o);
    adr[key] = Math.round(level / ((o / 100) * 30 || 1));
    const nights = (o / 100) * 30;
    bookings[key] = Math.max(1, Math.round(nights / stay));
  }
  return {
    id,
    revenue_ltm_monthly: revenue,
    occupancy_rate_ltm_monthly: occ,
    booked_daily_rate_ltm_monthly: adr,
    no_of_bookings_ltm_monthly: bookings,
    active_days_count_ltm: opts.activeDays ?? 340,
  };
}

/** ~20 comps: 16 established growing ~10%, one null-gapped, two newcomers, one part-year. */
export function manchesterComps(): FixtureComp[] {
  const comps: FixtureComp[] = [];
  for (let k = 0; k < 16; k++) comps.push(makeComp(`c${k}`, { base: 1200 + k * 60, growth: 0.08 + (k % 5) * 0.01 }));
  comps.push(makeComp('gapped', { nullKeys: ['2022-01', '2022-02', '2022-03', '2022-04', '2022-05'] }));
  comps.push(makeComp('new1', { start: '2024-10', growth: 0.5 }));
  comps.push(makeComp('new2', { start: '2025-06', growth: 0.5 }));
  comps.push(makeComp('partyear', { activeDays: 150, stay: 6 }));
  return comps;
}
