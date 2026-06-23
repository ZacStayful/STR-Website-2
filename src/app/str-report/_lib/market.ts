// Market data engine.
// In Phase 2, replace with a real API call (AirDNA or PropertyData).
// For now, use deterministic seeded variation by postcode + beds.

import type { MarketData, PropertyInput } from "./types";
import { ADR_DEFAULTS, MONTHLY_OCCUPANCY, grossMonthlyIncome } from "./calculations";

export function postcodeToSeed(postcode: string): number {
  return postcode
    .toUpperCase()
    .split("")
    .reduce((acc, c) => acc + c.charCodeAt(0), 0);
}

function demandDriversForPostcode(_postcode: string): { label: string; percentage: number }[] {
  // Default urban mix. A real implementation would infer the area type from
  // the postcode prefix; the shape is stable so the UI never breaks.
  return [
    { label: "Business travellers", percentage: 42 },
    { label: "Leisure weekends", percentage: 31 },
    { label: "Contractor stays", percentage: 18 },
    { label: "Events & tourism", percentage: 9 },
  ];
}

export function marketData(input: PropertyInput): MarketData {
  const seed = postcodeToSeed(input.postcode);
  const beds = input.beds;
  const listingCount = 220 + beds * 14 + (seed % 60);
  const adr = (ADR_DEFAULTS[beds] ?? 112) + (seed % 10) - 5;
  const medianGross = grossMonthlyIncome(beds) + (seed % 80) - 40;
  return {
    listingCount,
    avgDailyRate: adr,
    avgOccupancy: 71,
    medianGrossMonthly: medianGross,
    monthlyOccupancy: MONTHLY_OCCUPANCY,
    demandDrivers: demandDriversForPostcode(input.postcode),
  };
}
