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
  pdSoldPrices,
  pdDemandSale,
  pdDemandRent,
  pdRegionKeyStats,
} = pdQuestions(pdClient);

export type { LongLetRentAnswer, LongLetRentParams, PostcodeParams, OutcodeParams, RegionParams, SaleValuationParams, SoldPricesParams, StampDutyParams, StampDutyMode, StampDutyQuery } from './questions-propertydata-defs';
