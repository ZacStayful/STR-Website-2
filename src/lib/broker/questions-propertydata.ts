import 'server-only';

import { pdQuestions } from './questions-propertydata-defs';
import { pdClient } from './providers/propertydata';

/** The PropertyData questions bound to the real, metered client. */
export const {
  pdFloorAreas,
  pdLongLetRent,
  pdSaleValuation,
  pdStampDuty,
  pdMortgageRates,
  pdCouncilTax,
  pdEnergyEfficiency,
  pdFloodRisk,
  pdConservationArea,
  pdGreenBelt,
  pdAonb,
  pdNationalPark,
  pdListedBuildings,
  pdDemandSale,
  pdDemandRent,
  pdRegionKeyStats,
} = pdQuestions(pdClient);

export type { LongLetRentAnswer, LongLetRentParams, PostcodeParams, OutcodeParams, RegionParams, SaleValuationParams, StampDutyParams, StampDutyMode, StampDutyQuery } from './questions-propertydata-defs';
