import Link from "next/link";
import { areaMetaForCode } from "@/lib/market/areas";
import { formatOpenPrice, openPricePence, type DealOpenLadder } from "@/lib/marketplace/ladder";
import { badgesFor, describeType, type DealCard as Card } from "@/lib/marketplace/grid";

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

export function priceLine(card: Pick<Card, "price_amount" | "price_period">): string | null {
  if (card.price_amount === null) return null;
  const n = Number(card.price_amount);
  return card.price_period === "pcm" ? `${gbp(n)} pcm` : gbp(n);
}

export function headlineFigure(card: Pick<Card, "kind" | "annual_profit" | "uplift_pct">): { big: string; small: string } {
  const profit = card.annual_profit === null ? null : Number(card.annual_profit);
  if (card.kind === "rent") return { big: profit === null ? "—" : `${gbp(profit)}/yr`, small: "profit after rent" };
  const uplift = card.uplift_pct === null ? null : Number(card.uplift_pct);
  return { big: uplift === null ? "—" : `+${Math.round(uplift)}%`, small: profit === null ? "over a long let" : `${gbp(profit)}/yr over a long let` };
}

/**
 * One deal on the grid. Everything here is free to see: the figures, the
 * size, the town and outcode, the photo through the signed route. Never the
 * address or the listing link.
 */
export function DealCard({ card, photoUrl, ladder, now, opened = false }: { card: Card; photoUrl: string | null; ladder: DealOpenLadder; now: Date; opened?: boolean }) {
  const area = card.postcode_area ? areaMetaForCode(card.postcode_area) : null;
  const badges = badgesFor(card, now);
  const figure = headlineFigure(card);
  const price = priceLine(card);
  const where = [card.town, area?.name && area.name !== card.town ? area.name : null, card.outcode].filter(Boolean).join(" · ");
  const open = opened ? "Opened" : `Open · ${formatOpenPrice(openPricePence(card.annual_profit === null ? null : Number(card.annual_profit), ladder))}`;
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card">
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
          <p className="truncate text-xs text-muted-foreground">{describeType(card)}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className={"text-[11px] " + (badges.freshnessKind === "live" ? "text-primary" : "text-muted-foreground")}>{badges.freshness}</span>
            <span className={"rounded-md px-2 py-1 text-xs font-semibold " + (opened ? "bg-primary/10 text-primary" : "bg-primary text-primary-foreground")}>{open}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}
