import Link from "next/link";
import { areaMetaForCode } from "@/lib/market/areas";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import { formatListingPrice } from "@/lib/listing/format";
import { pipelineStatusInfo } from "@/lib/listing/pipeline";
import { myDealsFocusPath } from "@/lib/listing/return-path";
import type { ViewerDeal } from "@/lib/listing/tracked";
import type { TrackedCard } from "@/lib/listing/tracked-server";
import { openPricePence, type DealOpenLadder } from "@/lib/marketplace/ladder";
import { describeType, headlineFigure, priceLine } from "@/lib/marketplace/grid";
import { motivationLine } from "@/lib/marketplace/motivation-line";
import { photoUrlFor } from "@/lib/marketplace/queries";
import { StageSelect } from "./StageSelect";
import { NextStepSlot } from "./NextStepSlot";

const KIND: Record<string, string> = { sale: "To buy", rent: "Rent-to-rent", str: "Short let" };

const shortDate = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
};

/**
 * One deal on My deals: a compact row of what the deal card shows, with the
 * stage dropdown. A marketplace deal nobody on the team has opened shows only
 * what its card shows (town, outcode, figures) and never the address; an
 * opened deal, or a listing the member added themselves, shows the address.
 */
export function DealRow({
  item,
  card,
  address,
  ladder,
  adminUser,
  now,
  focused,
  personName,
  reportAction,
}: {
  item: ViewerDeal;
  /** The marketplace deal's card facts, for a marketplace deal. */
  card: TrackedCard | null;
  /** The address of an opened deal with no pipeline row of its own. */
  address: string | null;
  ladder: DealOpenLadder;
  adminUser: boolean;
  now: Date;
  focused: boolean;
  /** Name for a teammate's id. */
  personName: (id: string) => string;
  /** The report button for this item (open or run), drawn by the page. */
  reportAction?: React.ReactNode;
}) {
  const stageInfo = pipelineStatusInfo(item.stage);
  const back = myDealsFocusPath(item.key);
  const changed = shortDate(item.lastChangedAt);

  let href: string;
  let photo: string | null;
  let big: string;
  let small: string | null = null;
  let price: string | null = null;
  let title: string;
  let sub: string;
  let motivation: string[] = [];
  if (card) {
    const area = card.postcode_area ? areaMetaForCode(card.postcode_area) : null;
    const where = [card.town, area?.name && area.name !== card.town ? area.name : null, card.outcode].filter(Boolean).join(" · ") || "Location on the sheet";
    const figure = headlineFigure(card);
    href = `/deals/${card.id}`;
    photo = photoUrlFor(card, now) ?? (item.opened ? item.listing?.photo ?? null : null);
    big = figure.big;
    small = figure.small;
    price = priceLine(card);
    // The address rule: only for a deal the member may see the whole of.
    title = item.opened ? (item.listing?.address ?? address ?? where) : where;
    sub = [KIND[card.kind] ?? null, describeType(card)].filter(Boolean).join(" · ");
    motivation = motivationLine(card, now);
  } else {
    const l = item.listing;
    href = item.checkedListingId ? `/markets?pane=listings&listing=${encodeURIComponent(item.checkedListingId)}` : "/markets?pane=listings";
    photo = l?.photo ?? null;
    big = formatListingPrice(item.price);
    title = l?.address ?? l?.title ?? "Listing";
    sub = [KIND[item.kind] ?? null, l?.bedrooms ? `${l.bedrooms} bed` : null, l ? SOURCE_LABELS[l.source] : null].filter(Boolean).join(" · ");
  }
  const gone = card?.status === "retired";
  const openPence = card && !item.opened ? (adminUser ? 0 : openPricePence(card.annual_profit === null ? null : Number(card.annual_profit), ladder)) : null;

  return (
    <li id={item.key} className={"scroll-mt-24 rounded-xl border bg-card p-3 " + (focused ? "border-primary ring-2 ring-primary/40" : "border-border")}>
      <div className="flex gap-3">
        <Link href={href} className="relative h-20 w-24 shrink-0 overflow-hidden rounded-lg bg-muted" aria-hidden="true" tabIndex={-1}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground">No photo</span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-base font-bold text-foreground">{big}</p>
            {price && <p className="shrink-0 text-sm font-semibold text-foreground">{price}</p>}
          </div>
          {small && <p className="truncate text-xs text-muted-foreground">{small}</p>}
          <Link href={href} className="block truncate text-sm font-medium text-foreground hover:underline">
            {title}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{sub}</p>
          {motivation.length > 0 && <p className="truncate text-xs font-medium text-primary">{motivation.join(" · ")}</p>}
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
            {gone && <span className="font-semibold text-destructive">Off the market</span>}
            {card && !item.opened && !gone && <span>Not opened yet</span>}
            {changed && <span>Updated {changed}</span>}
            {!item.mine && <span>· by {personName(item.userId)}</span>}
            {item.alsoTrackedBy.length > 0 && <span>· also tracked by {item.alsoTrackedBy.map(personName).join(", ")}</span>}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-56">
          {item.mine ? (
            <StageSelect itemKey={item.key} stage={item.stage} opened={item.opened} dealId={card?.id ?? null} dealLive={card?.status === "live"} openPence={openPence} back={back} compact />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: stageInfo.colour }} aria-hidden="true" />
              {stageInfo.label} · {personName(item.userId)}’s
            </span>
          )}
        </div>
        {reportAction}
      </div>

      <NextStepSlot stage={item.stage} dealId={item.dealId} checkedListingId={item.checkedListingId} opened={item.opened} />
    </li>
  );
}
