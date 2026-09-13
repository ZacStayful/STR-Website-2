import type { AreaCardData, DistrictCardData, RegionCardData } from "@/lib/market/explorer";
import type { PersonalScore } from "@/lib/market/personalise";
import type { MarketGoals } from "@/lib/market/goals";
import type { ExplorerRow, SortKey } from "@/lib/market/rank";
import type { Budget, Beds, Region, Conf } from "@/lib/market/filters";

export type { AreaCardData, DistrictCardData, RegionCardData, PersonalScore, MarketGoals, ExplorerRow, SortKey };

export type MapMetric = "score" | "personal" | "yield" | "occupancy" | "revenue" | "adr" | "competition" | "seasonality" | "directBooking" | "accuracy";

export const MAP_METRICS: { key: MapMetric; label: string; needsGoals?: boolean }[] = [
  { key: "score", label: "Stayful score" },
  { key: "personal", label: "Your fit", needsGoals: true },
  { key: "yield", label: "Yield" },
  { key: "occupancy", label: "Occupancy" },
  { key: "revenue", label: "Revenue" },
  { key: "adr", label: "Daily rate" },
  { key: "competition", label: "Competition" },
  { key: "seasonality", label: "Seasonality" },
  { key: "directBooking", label: "Direct booking" },
  { key: "accuracy", label: "Data accuracy" },
];

/** The three views of the find screen: postcode areas, their districts, or the member's deals. */
export type Level = "markets" | "sub" | "deals";

export interface Filters {
  q: string;
  region: Region;
  budget: Budget;
  beds: Beds;
  conf: Conf;
  savedOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = { q: "", region: "any", budget: "any", beds: "any", conf: "any", savedOnly: false };

/** One step of the Regions › Area › District trail. */
export interface Crumb {
  label: string;
  /** Absent on the current (last) step. */
  onClick?: () => void;
}
