// Single source of truth for the headline scores shown across the dashboard,
// the PDF and the presentation, so all three always agree.

import type { AnalysisResult, RiskProfile } from "./types";

// Overall STR risk on a 0–100 scale (lower is better). The analyser stores
// `overallScore` on a 1–10 scale; the dashboard displays it ×10, so that is the
// canonical /100 value.
export function overallRiskScore100(risk: RiskProfile): number {
  return Math.max(0, Math.min(100, Math.round(risk.overallScore * 10)));
}

// Direct booking potential on a 0–100 scale (higher is better). Mirrors the
// dashboard's calculation exactly: base + demand-driver contributions.
export function directBookingScore(result: AnalysisResult): number {
  const d = result.demandDrivers;
  const hospitals = d.hospitals.length;
  const universities = d.universities.length;
  const totalTransport = d.trainStations.length + d.busStations.length + d.subwayStations.length;
  const totalEvents = result.nearbyEvents?.totalEvents ?? 0;
  const driverCount = [hospitals > 0, universities > 0, totalTransport > 0, totalEvents > 0].filter(Boolean).length;

  let score = 15; // base
  score += hospitals > 0 ? 15 : 0;
  score += universities > 0 ? 15 : 0;
  score += totalTransport >= 3 ? 20 : totalTransport >= 1 ? 12 : 0;
  score += totalEvents >= 100 ? 25 : totalEvents >= 50 ? 15 : totalEvents > 0 ? 5 : 0;
  score += driverCount >= 3 ? 10 : driverCount >= 2 ? 5 : 0;
  return Math.max(0, Math.min(100, score));
}
