import { DealCard } from "@/app/deals/_components/DealCard";
import { ShareDealButton } from "@/app/deals/_components/ShareDealButton";
import { photoUrlFor } from "@/lib/marketplace/queries";
import { earlyAccessFor } from "@/lib/marketplace/early-access";
import type { IntelligenceData } from "@/lib/intelligence/view-server";

/** Today's own DealCard for each of the view's cards, exactly as Today draws them. */
export function intelligenceCards(d: IntelligenceData, now: Date) {
  return d.cards.map((c) => (
    <DealCard
      key={c.id}
      card={c}
      photoUrl={photoUrlFor(c, now)}
      ladder={d.settings.dealOpenLadder}
      now={now}
      opened={d.opened.has(c.id)}
      reaction={d.answered.get(c.id) ?? null}
      earlyAccess={d.visibilityTier === "paid" ? earlyAccessFor(c.live_since, d.settings.freeDealDelayHours, now) : null}
      share={<ShareDealButton dealId={c.id} />}
      view={d.views.get(c.id)}
    />
  ));
}
