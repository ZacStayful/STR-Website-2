import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { areaMetaForSlug } from "@/lib/market/areas";
import { teaserForArea, photoUrlFor } from "@/lib/marketplace/queries";
import { describeType } from "@/lib/marketplace/grid";
import { headlineFigure, priceLine } from "@/app/deals/_components/DealCard";
import { siteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const meta = areaMetaForSlug(slug);
  if (!meta) return { title: "Short-let deals" };
  const title = `Short-let deals in ${meta.name}: properties that beat a long let`;
  const description = `Properties for sale and to rent in ${meta.name} (${meta.code}) that Stayful estimates net at least 40% more as a short let than a long let, or £8,000 a year after rent. Updated every morning.`;
  return { title, description, alternates: { canonical: siteUrl(`/short-let-deals/${meta.slug}`) } };
}

/**
 * The public, indexable teaser for one area: how many deals are live, what
 * they make, and the top three with their figures but no address, photo
 * detail or link. A signed-in member is sent straight to the grid.
 */
export default async function AreaDealsTeaserPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meta = areaMetaForSlug(slug);
  if (!meta) notFound();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(`/deals?areas=${encodeURIComponent(meta.code)}`);
  const teaser = await teaserForArea(meta.code);
  const now = new Date();
  const signup = `/signup?next=${encodeURIComponent(`/deals?areas=${meta.code}`)}`;
  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]"><Link href="/short-let-deals">Deals marketplace</Link> · {meta.code}</p>
      <h1 className="mt-2 text-3xl font-bold text-[#2e3d2b]">Short-let deals in {meta.name}</h1>
      <p className="mt-3 text-[#5b6657]">Every listing on the market in {meta.name} that Stayful estimates nets at least 40% more as a short let than a long let, or £8,000 a year after rent for rent-to-rent. Checked against the listing page and updated every morning.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Live deals" value={teaser ? String(teaser.total) : "—"} sub={teaser ? `${teaser.sale} to buy · ${teaser.rent} rent-to-rent` : undefined} />
        <Tile label="Median profit / yr" value={teaser?.medianProfit !== null && teaser?.medianProfit !== undefined ? gbp(teaser.medianProfit) : "—"} sub="over a long let, or after rent" />
        <Tile label="Stayful area score" value={teaser?.area?.score !== null && teaser?.area?.score !== undefined ? `${teaser.area.score}/100` : "—"} />
        <Tile label="Occupancy · nightly" value={teaser?.area?.occupancy !== null && teaser?.area?.occupancy !== undefined ? `${Math.round(teaser.area.occupancy)}%${teaser.area.adr ? ` · ${gbp(teaser.area.adr)}` : ""}` : "—"} />
      </div>

      {teaser && teaser.top.length > 0 ? (
        <ul className="mt-8 grid gap-4 sm:grid-cols-3">
          {teaser.top.map((card) => {
            const fig = headlineFigure(card);
            const photo = photoUrlFor(card, now);
            return (
              <li key={card.id} className="overflow-hidden rounded-xl border border-[#e4e7dc] bg-white">
                <div className="relative aspect-[4/3] bg-[#e8ebe3]">
                  {photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover blur-md" />
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">{card.kind === "rent" ? "Rent-to-rent" : "To buy"}</span>
                </div>
                <div className="p-3">
                  <p className="text-lg font-bold text-[#2e3d2b]">{fig.big} <span className="text-xs font-normal text-[#7a8274]">{fig.small}</span></p>
                  <p className="mt-1 text-sm text-[#2e3d2b]">{[priceLine(card), describeType(card)].filter(Boolean).join(" · ")}</p>
                  <p className="text-xs text-[#7a8274]">{[card.town, card.outcode].filter(Boolean).join(" · ")}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-8 rounded-xl border border-dashed border-[#e4e7dc] p-8 text-center text-sm text-[#7a8274]">No live deals in {meta.name} this morning. New listings are screened every day.</p>
      )}

      <section className="mt-10 rounded-2xl bg-[#2e3d2b] p-6 text-white">
        <h2 className="text-xl font-bold">See every deal in {meta.name}, with the working</h2>
        <p className="mt-2 text-sm text-[#d7e0d0]">A free account shows the full grid with the income figures, the uplift over a long let and the profit after rent. Opening a deal for its address, photos and listing link costs a few pence of credit, and every new member starts with £20.</p>
        <p className="mt-4 flex flex-wrap gap-2">
          <Link href={signup} className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-[#2e3d2b]">Start free</Link>
          <Link href={`/login?redirect=${encodeURIComponent(`/deals?areas=${meta.code}`)}`} className="rounded-md border border-white/40 px-4 py-2 text-sm font-medium text-white">Sign in</Link>
        </p>
      </section>
      <p className="mt-6 text-xs text-[#7a8274]">Short-let income is Stayful’s estimate for the area and property size, not the property’s own history. Prices and rents are the listings’ own. Nothing here is a guarantee of income.</p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#e4e7dc] bg-white p-4">
      <p className="text-xs text-[#7a8274]">{label}</p>
      <p className="mt-1 text-xl font-bold text-[#2e3d2b]">{value}</p>
      {sub && <p className="text-[11px] text-[#7a8274]">{sub}</p>}
    </div>
  );
}
