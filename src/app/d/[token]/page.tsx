import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { areaMetaForCode } from "@/lib/market/areas";
import { describeType, priceLine } from "@/lib/marketplace/grid";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { profitRange, upliftTag } from "@/lib/marketplace/profit-range";
import { BasicVsDetailed } from "@/app/deals/_components/BasicVsDetailed";
import { motivationLine } from "@/lib/marketplace/motivation-line";
import { photoUrlFor } from "@/lib/marketplace/queries";
import { sharedDealByToken } from "@/lib/marketplace/share";
import { joinPath, shareState, shareTitle, type ShareState } from "@/lib/marketplace/share-view";
import { publicDealVisibility } from "@/lib/marketplace/tier";
import { siteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

const DESCRIPTIONS: Record<ShareState, string> = {
  card: "A short-let deal found by Stayful. Join free to see deals like this.",
  members_only: "Stayful members are seeing this deal now. Join free to see deals like this.",
  gone: "This deal has gone. Join free to see deals like this.",
};

/**
 * Everything the page and its link preview may use, decided once. The state
 * is judged against what a signed-out visitor may see (Batch 1's delay), so a
 * share link can never be a way round early access — whoever shared it.
 */
async function load(token: string) {
  const shared = await sharedDealByToken(token);
  if (!shared) return null;
  const { card } = shared;
  const visibility = await publicDealVisibility();
  const state = shareState(card, visibility.cutoffIso);
  const area = card.postcode_area ? areaMetaForCode(card.postcode_area) : null;
  const where = [card.town, area?.name && area.name !== card.town ? area.name : null, card.outcode].filter(Boolean).join(" · ");
  const now = new Date();
  // Batch 10: the profit as an area-estimate range at the house finance (a public page knows nobody's own).
  const widths = (await getBillingSettings()).dealPricing.profitRangePct;
  const range = state === "card" ? profitRange({ kind: card.kind, priceAmount: card.price_amount, pricePeriod: card.price_period, bedrooms: card.bedrooms, grossRevenue: card.screening_gross ?? null, confidence: card.screening_confidence ?? null, finance: null, widths }) : null;
  return {
    card,
    state,
    now,
    range,
    join: joinPath(shared.referralCode),
    // In early access: the area and nothing narrower.
    place: state === "card" ? where : (area?.name ?? ""),
    photoUrl: state === "card" ? photoUrlFor(card, now) : null,
  };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const v = await load(token);
  const robots = { index: false, follow: false };
  if (!v) return { title: "Stayful Intelligence", robots };
  const title = shareTitle(v.card, v.place, v.state, v.range?.label ?? null);
  const description = DESCRIPTIONS[v.state];
  const images = v.photoUrl ? [siteUrl(v.photoUrl)] : undefined;
  return {
    title,
    description,
    robots,
    openGraph: { title, description, images, type: "website", siteName: "Stayful" },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images },
  };
}

/**
 * A deal a member shared. Only what the deal card shows — the figures, the
 * town and outcode, the type, the photo through the signed route, the
 * motivation line — never the address, postcode or listing link, even when
 * the sharer has paid to open it. One call to action: join, on the sharer's
 * referral code.
 */
export default async function SharedDealPage({ params }: Params) {
  const { token } = await params;
  const v = await load(token);
  if (!v) notFound();
  const { card, state, now } = v;
  const kind = card.kind === "rent" ? "Rent-to-rent" : "To buy";

  return (
    <main className="min-h-screen bg-[#f7f8f4] text-[#2e3d2b]">
      <div className="mx-auto max-w-xl px-5 py-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]">Shared from Stayful</p>

        {state === "gone" ? (
          <section className="mt-3 rounded-2xl border border-[#e4e7dc] bg-white p-6">
            <h1 className="text-2xl font-bold">This deal has gone</h1>
            <p className="mt-2 text-sm text-[#7a8274]">It sold, was let or was taken off the market. New deals like it arrive every morning.</p>
          </section>
        ) : state === "members_only" ? (
          <section className="mt-3 rounded-2xl border border-[#e4e7dc] bg-white p-6">
            <span className="rounded-full bg-[#2e3d2b] px-2 py-0.5 text-[11px] font-semibold text-white">{kind}</span>
            <h1 className="mt-3 text-2xl font-bold">Available to members</h1>
            <p className="mt-2 text-sm text-[#7a8274]">A new short-let deal{v.place ? ` in ${v.place}` : ""}. Stayful members are seeing it now.</p>
          </section>
        ) : (
          <SharedCard card={card} kind={kind} where={v.place} photoUrl={v.photoUrl} now={now} range={v.range} />
        )}

        <Link href={v.join} className="mt-6 block rounded-xl bg-[#2e3d2b] px-5 py-3 text-center text-base font-semibold text-white hover:opacity-90">
          Join free to see deals like this
        </Link>
        <BasicVsDetailed className="mt-4" />
      </div>
    </main>
  );
}

function SharedCard({ card, kind, where, photoUrl, now, range }: { card: NonNullable<Awaited<ReturnType<typeof load>>>["card"]; kind: string; where: string; photoUrl: string | null; now: Date; range: ReturnType<typeof profitRange> }) {
  const uplift = card.kind === "sale" ? upliftTag(card.uplift_pct) : null;
  const price = priceLine(card);
  const type = describeType(card);
  const motivation = motivationLine(card, now);
  return (
    <article className="mt-3 overflow-hidden rounded-2xl border border-[#e4e7dc] bg-white">
      <div className="relative aspect-[4/3] w-full bg-[#e8ebe3]">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-[#7a8274]">{card.source === "zoopla" ? "Photo on the listing" : "Photo coming"}</div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">{kind}</span>
      </div>
      <div className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-2xl font-bold">{range?.label ?? "—"}</p>
          {price && <p className="text-lg font-semibold">{price}</p>}
        </div>
        <p className="text-sm text-[#7a8274]">area estimate{range ? ` · ${range.basis}` : ""}{uplift ? ` · ${uplift}` : ""}</p>
        {where && <p className="mt-2 text-base font-medium">{where}</p>}
        {motivation.length > 0 && <p className="text-sm font-medium text-[#5d8156]">{motivation.join(" · ")}</p>}
        {type && <p className="text-sm text-[#7a8274]">{type}</p>}
      </div>
    </article>
  );
}
