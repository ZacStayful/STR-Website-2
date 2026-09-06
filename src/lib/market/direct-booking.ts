/**
 * Direct-booking potential for an area (0–100, higher is better): how much
 * reason guests there have to book off-platform and come back. Weighted by
 * what actually drives direct bookings in Stayful's own experience:
 *
 *   contractors   30   large planning applications nearby, last 12 months (PlanIt)
 *   hospitals     25   share of analysed properties with a hospital nearby
 *   universities  20   share with a university nearby
 *   events        15   average nearby events (tourism / leisure)
 *   transport     10   share with a train / bus / metro hub nearby
 *
 * Every point is explainable (`components`). Missing inputs are dropped and
 * the remaining weights renormalised; null when nothing is known at all.
 */

import type { AreaDemandRaw } from './types.ts';

export type DirectBookingLabel = 'Low' | 'Moderate' | 'Strong';

export interface DirectBookingComponent {
  key: 'contractors' | 'hospitals' | 'universities' | 'events' | 'transport';
  label: string;
  weight: number;
  earned: number | null; // 0..weight
  detail: string;
}

export interface DirectBooking {
  score: number;
  label: DirectBookingLabel;
  components: DirectBookingComponent[];
  sampleCount: number;
  /** Change in large planning applications vs the previous 12 months, or null. */
  contractorTrend: 'up' | 'flat' | 'down' | null;
}

function band(value: number, lo: number, hi: number, weight: number): number {
  return Math.max(0, Math.min(weight, ((value - lo) / (hi - lo)) * weight));
}

export function directBookingLabel(score: number): DirectBookingLabel {
  if (score < 35) return 'Low';
  if (score < 60) return 'Moderate';
  return 'Strong';
}

const PLANNING_FULL = 40; // large applications / 12 months for full marks
const EVENTS_FULL = 100;

export function areaDirectBooking(demand: AreaDemandRaw | null | undefined): DirectBooking | null {
  if (!demand) return null;
  const pct = (v: number | null) => (v === null ? 'No data' : `${Math.round(v * 100)}% of analysed properties`);
  const apps = demand.large_planning_apps_12m;
  const components: DirectBookingComponent[] = [
    {
      key: 'contractors', label: 'Contractor projects', weight: 30,
      earned: apps === null ? null : band(apps, 0, PLANNING_FULL, 30),
      detail: apps === null ? 'No planning data yet' : `${apps} large planning applications in 12 months`,
    },
    { key: 'hospitals', label: 'Hospitals & medical', weight: 25, earned: demand.share_hospital === null ? null : demand.share_hospital * 25, detail: pct(demand.share_hospital) },
    { key: 'universities', label: 'Universities', weight: 20, earned: demand.share_university === null ? null : demand.share_university * 20, detail: pct(demand.share_university) },
    {
      key: 'events', label: 'Events & tourism', weight: 15,
      earned: demand.avg_events === null ? null : band(demand.avg_events, 0, EVENTS_FULL, 15),
      detail: demand.avg_events === null ? 'No data' : `${Math.round(demand.avg_events)} events nearby on average`,
    },
    { key: 'transport', label: 'Transport hubs', weight: 10, earned: demand.share_transport === null ? null : demand.share_transport * 10, detail: pct(demand.share_transport) },
  ];
  const present = components.filter((c) => c.earned !== null);
  if (present.length === 0) return null;
  const wTotal = present.reduce((s, c) => s + c.weight, 0);
  const score = Math.round((present.reduce((s, c) => s + (c.earned ?? 0), 0) * 100) / wTotal);

  let contractorTrend: DirectBooking['contractorTrend'] = null;
  if (apps !== null && demand.large_planning_apps_prev_12m !== null) {
    const prev = demand.large_planning_apps_prev_12m;
    const delta = prev === 0 ? (apps > 0 ? 1 : 0) : (apps - prev) / prev;
    contractorTrend = delta > 0.1 ? 'up' : delta < -0.1 ? 'down' : 'flat';
  }

  return { score, label: directBookingLabel(score), components, sampleCount: demand.sample_count, contractorTrend };
}
