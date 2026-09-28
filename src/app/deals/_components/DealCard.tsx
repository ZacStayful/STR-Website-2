import Link from "next/link";
import { areaMetaForCode } from "@/lib/market/areas";
import { formatOpenPrice, openPricePence, type DealOpenLadder } from "@/lib/marketplace/ladder";
import { AUCTION_LABEL, badgesFor, describeType, headlineFigure, isAuctionCard, priceLine, type DealCard as Card } from "@/lib/marketplace/grid";
import { payLine } from "@/lib/marketplace/most-you-can-pay";
import { motivationLine } from "@/lib/marketplace/motivation-line";
import { earlyAccessHint } from "@/lib/marketplace/early-access";
import { PASS_REASON_GROUPS, type DealReaction } from "@/lib/marketplace/reactions";
import { priceText } from "@/lib/credit/deal-pricing";
import type { CardView } from "@/lib/marketplace/card-view";
import { ANALYSIS_LEAD_LINE } from "@/lib/tailoring/about-prompts";
import { openDealAction } from "../actions";
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
  /**
   * For a paying member only: the deal is still inside the free members'
   * delay, and this is when they get it (earlyAccessFor in
   * src/lib/marketplace/early-access.ts). Never set it for a free member.
   */
  earlyAccess?: { freeAt: Date } | null;
  /** Keep / Pass (and `share`) under the card. False draws a read-only card. Default true. */
  actions?: boolean;
  /** The share button for this deal, when sharing is on. */
  share?: React.ReactNode;
  /**
   * Batch 10: what this member sees (cardView, src/lib/marketplace/card-view.ts):
   * the profit range at their finance, Opened / Analysed, and the Quick look
   * and Full analysis buttons at their own price. Without it the card draws
   * as it did before.
   */
  view?: CardView;
}

/**
 * One deal. Everything here is free to see: the figures, the size, the town
 * and outcode, the motivation line, the photo through the signed route.
 * Never the address, the postcode or the listing link. Reused by the /deals
 * grid and, later, the Today screen and My deals.
 */
export function DealCard({ card, photoUrl, ladder, now, opened = false, reaction = null, earlyAccess = null, actions = true, share, view }: DealCardProps) {
  const area = card.postcode_area ? areaMetaForCode(card.postcode_area) : null;
  const badges = badgesFor(card, now);
  const figure = headlineFigure(card);
  const price = priceLine(card);
  // An auction lot's figure is a guide, not an asking price (Batch 16).
  const auction = isAuctionCard(card);
  const priceWord = auction ? "Guide" : "Asking";
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
          {earlyAccess && <span className="rounded-full bg-warning px-2 py-0.5 text-[11px] font-semibold text-warning-foreground">Early access</span>}
          {auction && <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">{AUCTION_LABEL}</span>}
          {/* Batch 16, Part F: the low-entry stream (the house finance gets in for at most the low-entry cash). */}
          {view?.lowEntry && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">Low entry</span>}
          {badges.tags.map((t) => (
            <span key={t} className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{t}</span>
          ))}
          {view?.explanation?.elsewhere && <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">Best elsewhere</span>}
        </div>
      </div>
      <div className="p-3">
        {view?.numbers && view.numbers.length > 0 ? (
          <>
            {/* Batch 14: three numbers for this member's role and goal (src/lib/tailoring/numbers.ts). */}
            <dl className="grid grid-cols-3 gap-2">
              {view.numbers.map((n) => (
                <div key={n.key} className="min-w-0">
                  <dd className="truncate text-sm font-bold text-foreground">{n.value}</dd>
                  <dt className="truncate text-[11px] text-muted-foreground">{n.label}</dt>
                  {n.help && <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{n.help}</p>}
                </div>
              ))}
            </dl>
            <p className="mt-1 text-[11px] text-muted-foreground">
              area estimate
              {view.uplift && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{view.uplift}</span>}
            </p>
            {/* Batch 16, Part F: what it takes to get in ("£38k cash in" / "£12k to start") sits with the price on every card. */}
            <p className="mt-0.5 text-xs font-medium text-foreground">
              {[price ? `${priceWord} ${price}` : null, view.cash, view.pay ? payLine(view.pay) : null].filter(Boolean).join(" · ")}
            </p>
          </>
        ) : (
          <>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-lg font-bold text-foreground">{view ? (view.range?.label ?? "—") : figure.big}</p>
          {price && <p className="text-sm font-semibold text-foreground">{price}</p>}
        </div>
        {view ? (
          <>
            <p className="text-xs text-muted-foreground">
              area estimate{view.range ? ` · ${view.range.basis}` : ""}
              {view.uplift && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{view.uplift}</span>}
            </p>
            {/* Batch 14: the most they can pay to hit their own monthly profit, beside the asking figure; Batch 16: the cash in / to start. */}
            {(view.pay || view.cash) && <p className="mt-0.5 text-xs font-medium text-foreground">{[price ? `${priceWord} ${price}` : null, view.cash, view.pay ? payLine(view.pay) : null].filter(Boolean).join(" · ")}</p>}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{figure.small}</p>
        )}
          </>
        )}
        {/* Batch 14: why it is on their list, and how well it matches. */}
        {view?.explanation && (view.explanation.why || view.explanation.match) && (
          <p className="mt-1 text-xs text-primary">
            {view.explanation.match && <span className="mr-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold">{view.explanation.match}</span>}
            {view.explanation.why}
          </p>
        )}
        {view?.explanation?.flags.map((f) => (
          <p key={f} className="text-[11px] font-medium text-warning">{f}</p>
        ))}
        <p className="mt-1.5 truncate text-sm font-medium text-foreground">{where || "Location on the sheet"}</p>
        {motivation.length > 0 && <p className="truncate text-xs font-medium text-primary">{motivation.join(" · ")}</p>}
        <p className="truncate text-xs text-muted-foreground">{describeType(card)}</p>
        {earlyAccess && <p className="mt-1 text-[11px] font-medium text-foreground">{earlyAccessHint(earlyAccess.freeAt, now)}</p>}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={"text-[11px] " + (badges.freshnessKind === "live" ? "text-primary" : "text-muted-foreground")}>{badges.freshness}</span>
          {view ? (
            <span className="flex gap-1">
              {view.opened && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Opened</span>}
              {view.analysed && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Analysed</span>}
            </span>
          ) : (
            <span className={"rounded-md px-2 py-1 text-xs font-semibold " + (opened ? "bg-primary/10 text-primary" : "bg-primary text-primary-foreground")}>{open}</span>
          )}
        </div>
      </div>
    </Link>
  );
  // The buttons sit outside the card's link: a button inside a link is not one.
  const buyButtons = view ? <PriceButtons dealId={card.id} live={card.status === "live"} view={view} /> : null;
  if (!actions)
    return (
      <li className="overflow-hidden rounded-xl border border-border bg-card">
        {body}
        {buyButtons}
      </li>
    );
  return (
    <DealCardFrame dealId={card.id} initialReaction={reaction} reasonGroups={PASS_REASON_GROUPS} share={share}>
      {body}
      {buyButtons}
    </DealCardFrame>
  );
}

/**
 * Quick look and Full analysis, at this member's price. Unopened: Quick look
 * is one tap (it opens and lands on the unlocked sheet); Full analysis goes
 * to the sheet with its confirm panel open, where one confirm buys the look
 * and the analysis together. Opened: the Full analysis at the difference.
 * Analysed: the analysis itself.
 */
function PriceButtons({ dealId, live, view }: { dealId: string; live: boolean; view: CardView }) {
  const btn = "rounded-md px-2.5 py-1.5 text-xs font-semibold";
  if (view.analysed && view.reportId) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <Link href={`/reports/${view.reportId}?back=${encodeURIComponent(`/deals/${dealId}`)}`} className={`${btn} bg-primary text-primary-foreground hover:opacity-90`}>Open full analysis</Link>
      </div>
    );
  }
  const full = view.fullAnalysis ? priceText(view.fullAnalysis) : "";
  const quick = !view.opened && live && view.quickLook ? (
    <form action={openDealAction}>
      <input type="hidden" name="id" value={dealId} />
      <button type="submit" className={`${btn} border border-border text-foreground hover:bg-muted`}>Quick look{priceText(view.quickLook) ? ` · ${priceText(view.quickLook)}` : ""}</button>
    </form>
  ) : null;
  const analysis = view.opened || live ? <Link href={`/deals/${dealId}?analysis=1`} className={`${btn} bg-primary text-primary-foreground hover:opacity-90`}>Full analysis{full ? ` · ${full}` : ""}</Link> : null;
  // Batch 14, Part E: "Knowing the numbers" holds them back, so the Full analysis comes first, with one line.
  if (view.lead === "analysis" && analysis) {
    return (
      <div className="border-t border-border px-3 py-2">
        <p className="mb-1.5 text-[11px] text-muted-foreground">{ANALYSIS_LEAD_LINE}</p>
        <div className="flex flex-wrap items-center gap-2">
          {analysis}
          {quick}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
      {quick}
      {analysis}
    </div>
  );
}
