import Link from "next/link";
import { areaMetaForCode } from "@/lib/market/areas";
import { formatOpenPrice, openPricePence, type DealOpenLadder } from "@/lib/marketplace/ladder";
import { badgesFor, describeType, headlineFigure, priceLine, type DealCard as Card } from "@/lib/marketplace/grid";
import { motivationLine } from "@/lib/marketplace/motivation-line";
import { PASS_REASON_GROUPS, type DealReaction } from "@/lib/marketplace/reactions";
import { DealCardFrame } from "./DealCardFrame";

// Re-exported for the pages that format a deal without rendering this card.
export { headlineFigure, priceLine };

export interface DealCardProps {
  /**
   * The deal, as selected with CARD_COLUMNS (src/lib/marketplace/grid.ts)
   * plus `has_photo`. PUBLIC_DEAL_COLUMNS alone also works; the motivation
   * line then simply does not show. Never a row carrying the private columns.
   */
  card: Card;
  /** photoUrlFor(card, now): the signed photo proxy, never the portal's own image URL. Null draws "Photo coming". */
  photoUrl: string | null;
  /** getBillingSettings().dealOpenLadder, for the open price. */
  ladder: DealOpenLadder;
  now: Date;
  /** The member (or anyone on their team) has opened this deal. */
  opened?: boolean;
  /** The member's own Keep / Pass on it (reactionsFor in src/lib/marketplace/reactions-server.ts). */
  reaction?: DealReaction | null;
  /** Keep / Pass (and `share`) under the card. False draws a read-only card. Default true. */
  actions?: boolean;
  /** The share button for this deal, when sharing is on. */
  share?: React.ReactNode;
}

/**
 * One deal. Everything here is free to see: the figures, the size, the town
 * and outcode, the motivation line, the photo through the signed route.
 * Never the address, the postcode or the listing link. Reused by the /deals
 * grid and, later, the Today screen and My deals.
 */
export function DealCard({ card, photoUrl, ladder, now, opened = false, reaction = null, actions = true, share }: DealCardProps) {
  const area = card.postcode_area ? areaMetaForCode(card.postcode_area) : null;
  const badges = badgesFor(card, now);
  const figure = headlineFigure(card);
  const price = priceLine(card);
  const motivation = motivationLine(card, now);
  const where = [card.town, area?.name && area.name !== card.town ? area.name : null, card.outcode].filter(Boolean).join(" · ");
  const open = opened ? "Opened" : `Open · ${formatOpenPrice(openPricePence(card.annual_profit === null ? null : Number(card.annual_profit), ladder))}`;
  const body = (
    <Link href={`/deals/${card.id}`} className="block hover:bg-muted/40">
      <div className="relative aspect-[4/3] w-full bg-muted">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">{card.source === "zoopla" ? "Photo on the listing" : "Photo coming"}</div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">{card.kind === "rent" ? "Rent-to-rent" : "To buy"}</span>
          {badges.tags.map((t) => (
            <span key={t} className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{t}</span>
          ))}
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-lg font-bold text-foreground">{figure.big}</p>
          {price && <p className="text-sm font-semibold text-foreground">{price}</p>}
        </div>
        <p className="text-xs text-muted-foreground">{figure.small}</p>
        <p className="mt-1.5 truncate text-sm font-medium text-foreground">{where || "Location on the sheet"}</p>
        {motivation.length > 0 && <p className="truncate text-xs font-medium text-primary">{motivation.join(" · ")}</p>}
        <p className="truncate text-xs text-muted-foreground">{describeType(card)}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={"text-[11px] " + (badges.freshnessKind === "live" ? "text-primary" : "text-muted-foreground")}>{badges.freshness}</span>
          <span className={"rounded-md px-2 py-1 text-xs font-semibold " + (opened ? "bg-primary/10 text-primary" : "bg-primary text-primary-foreground")}>{open}</span>
        </div>
      </div>
    </Link>
  );
  if (!actions) return <li className="overflow-hidden rounded-xl border border-border bg-card">{body}</li>;
  return (
    <DealCardFrame dealId={card.id} initialReaction={reaction} reasonGroups={PASS_REASON_GROUPS} share={share}>
      {body}
    </DealCardFrame>
  );
}
