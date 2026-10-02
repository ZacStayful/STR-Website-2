import { dealRowTitle } from "@/lib/listing/row-title";
import { formatListingPrice } from "@/lib/listing/format";
import { pipelineStatusInfo } from "@/lib/listing/pipeline";
import { priceLine } from "@/lib/marketplace/grid";
import type { ViewerDeal } from "@/lib/listing/tracked";
import type { TrackedLoad } from "@/lib/listing/tracked-server";

/** One tracked deal in a short list (Start again's tick list, Cleared deals): title, stage and price as My deals shows them. */
export interface DealSummary {
  key: string;
  title: string;
  stage: string;
  price: string | null;
}

export function dealSummary(item: ViewerDeal, load: Pick<TrackedLoad, "cards" | "addresses">): DealSummary {
  const card = item.dealId ? load.cards.get(item.dealId) ?? null : null;
  return {
    key: item.key,
    // The address rule: never the address of a deal that has not been opened.
    title: dealRowTitle(item, card, item.dealId ? load.addresses.get(item.dealId) ?? null : null),
    stage: pipelineStatusInfo(item.stage).label,
    price: card ? priceLine(card) : item.price ? formatListingPrice(item.price) : null,
  };
}
