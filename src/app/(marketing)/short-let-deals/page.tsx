import type { Metadata } from "next";
import Link from "next/link";
import { areaMetaForCode } from "@/lib/market/areas";
import { liveCountsByArea } from "@/lib/marketplace/queries";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "Short-let deals on the market right now, by area";
const PAGE_DESCRIPTION = "Every property for sale or to rent in Stayful's top UK short-let areas that nets at least 40% more as a short let than a long let, or £8,000 a year after rent. Updated every morning.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: siteUrl("/short-let-deals") },
};

export const revalidate = 3600;

/** The public index: every area with live deals, linked to its teaser page. */
export default async function ShortLetDealsIndexPage() {
  const counts = (await liveCountsByArea()).filter((c) => c.total > 0);
  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]">Deals marketplace</p>
      <h1 className="mt-2 text-3xl font-bold text-[#2e3d2b]">{PAGE_TITLE}</h1>
      <p className="mt-3 text-[#5b6657]">{PAGE_DESCRIPTION} Members see every deal with its figures; opening one shows the address, photos and listing link.</p>
      {counts.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-[#e4e7dc] p-8 text-center text-sm text-[#7a8274]">The first sweep is running. Check back tomorrow morning.</p>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {counts.map((c) => {
            const meta = areaMetaForCode(c.code);
            return (
              <li key={c.code}>
                <Link href={`/short-let-deals/${meta.slug}`} className="flex items-center justify-between rounded-xl border border-[#e4e7dc] bg-white px-4 py-3 hover:border-[#5d8156]">
                  <span className="font-semibold text-[#2e3d2b]">{meta.name} <span className="text-xs font-normal text-[#7a8274]">({c.code})</span></span>
                  <span className="text-sm text-[#5b6657]">{c.total} deal{c.total === 1 ? "" : "s"} · {c.sale} to buy · {c.rent} rent-to-rent</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-10 text-sm text-[#5b6657]">
        <Link href="/signup?next=%2Fdeals" className="rounded-md bg-[#2e3d2b] px-4 py-2 font-semibold text-white">Start free and see every deal</Link>
      </p>
    </div>
  );
}
