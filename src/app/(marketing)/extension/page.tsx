import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "Browser extension — Stayful Intelligence on every listing";
const PAGE_DESCRIPTION =
  "See what a Rightmove, Zoopla, OnTheMarket, Airbnb or Booking.com listing would earn as a short-term let while you browse. Estimated revenue, area score, deal maths and one-click save to your pipeline.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: siteUrl("/extension") },
};

const SITES = [
  { name: "Rightmove", what: "Asking price or rent, beds, postcode → revenue estimate and deal maths" },
  { name: "Zoopla", what: "Same as Rightmove, read straight from the page you are on" },
  { name: "OnTheMarket", what: "Sale and rental listings, including rent-to-rent margin" },
  { name: "Airbnb", what: "What this listing actually earns when a provider tracks it, plus nearby competitors" },
  { name: "Booking.com", what: "Rate benchmark: the nightly rate on the page against the area's average" },
];

export default function ExtensionPage() {
  const id = process.env.NEXT_PUBLIC_EXTENSION_ID;
  const storeUrl = id ? `https://chromewebstore.google.com/detail/${id}` : null;
  return (
    <section className="mx-auto max-w-3xl px-5 py-16">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]">Browser extension</p>
      <h1 className="mt-2 text-3xl font-bold text-[#2e3d2b]">Stayful on every listing page</h1>
      <p className="mt-3 text-base text-[#5a6356]">
        Install the extension and a Stayful panel appears on listing pages as you browse: estimated short-let revenue, the area&apos;s score and competition, and whether the deal works at the asking price or rent. One click saves it to your pipeline or opens the full report.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        {storeUrl ? (
          <a href={storeUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-[#5d8156] px-5 py-2.5 text-sm font-semibold text-white">
            Add to Chrome
          </a>
        ) : (
          <span className="rounded-full bg-[#e4e7dc] px-5 py-2.5 text-sm font-semibold text-[#5a6356]">Chrome Web Store listing coming soon</span>
        )}
        <Link href="/extension/connect" className="rounded-full border border-[#5d8156] px-5 py-2.5 text-sm font-semibold text-[#5d8156]">
          Connect to my account
        </Link>
      </div>

      <h2 className="mt-12 text-xl font-bold text-[#2e3d2b]">What you see, site by site</h2>
      <ul className="mt-4 divide-y divide-[#e4e7dc] rounded-2xl border border-[#e4e7dc] bg-white">
        {SITES.map((s) => (
          <li key={s.name} className="flex gap-4 px-5 py-3 text-sm">
            <span className="w-32 shrink-0 font-semibold text-[#2e3d2b]">{s.name}</span>
            <span className="text-[#5a6356]">{s.what}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 text-xl font-bold text-[#2e3d2b]">How it works</h2>
      <ol className="mt-4 space-y-3 text-sm text-[#5a6356]">
        <li><strong className="text-[#2e3d2b]">1. Install</strong> the extension from the Chrome Web Store.</li>
        <li><strong className="text-[#2e3d2b]">2. Connect</strong> it to your Stayful account. The extension gets its own token, which you can revoke at any time.</li>
        <li><strong className="text-[#2e3d2b]">3. Browse.</strong> Open a listing on any supported site and the panel appears. Quick views are free for members; a full report uses one of your runs, as on the site.</li>
      </ol>

      <p className="mt-10 text-xs text-[#7a8274]">
        The extension reads the listing page you are looking at and sends the property details to Stayful; it never reads other tabs or your browsing history. Details in the <Link href="/extension/privacy" className="underline">extension privacy notes</Link>.
      </p>
    </section>
  );
}
