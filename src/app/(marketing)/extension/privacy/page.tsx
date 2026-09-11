import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/url";

export const metadata: Metadata = {
  title: "Browser extension privacy — Stayful Intelligence",
  description: "What the Stayful browser extension reads, sends and stores, and how to disconnect it.",
  alternates: { canonical: siteUrl("/extension/privacy") },
};

export default function ExtensionPrivacyPage() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-16 text-[#2e3d2b]">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]">Browser extension</p>
      <h1 className="mt-2 text-3xl font-bold">Privacy notes</h1>
      <p className="mt-3 text-sm text-[#5a6356]">Last updated 10 September 2026.</p>

      <h2 className="mt-10 text-lg font-bold">What the extension does</h2>
      <p className="mt-2 text-sm text-[#5a6356]">
        The Stayful browser extension runs only on property listing pages on Rightmove, Zoopla, OnTheMarket, Airbnb and Booking.com. When you open such a page and are connected to a Stayful account, it reads that page and shows a Stayful panel with an estimate for the property.
      </p>

      <h2 className="mt-8 text-lg font-bold">What it sends to Stayful</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#5a6356]">
        <li>The listing page&apos;s address (URL) and its HTML, so Stayful can read the property details (price or rent, bedrooms, postcode, photos by link).</li>
        <li>Your connection token, which identifies your Stayful account to the extension only.</li>
      </ul>
      <p className="mt-2 text-sm text-[#5a6356]">
        Stayful keeps the typed property details it extracts (never the page HTML, agent or host contact details, or descriptions) and records the listing in your pipeline so you can find it again. The same happens when you paste a listing link on the site.
      </p>

      <h2 className="mt-8 text-lg font-bold">What it does not do</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#5a6356]">
        <li>It does not read other tabs, your browsing history, cookies for other sites, or anything you type on a listing site.</li>
        <li>It does not run on any site other than the five listing sites above.</li>
        <li>It does not sell or share data with anyone; the figures come from Stayful&apos;s own data and licensed providers.</li>
      </ul>

      <h2 className="mt-8 text-lg font-bold">What it stores in your browser</h2>
      <p className="mt-2 text-sm text-[#5a6356]">Only your connection token and the address of the Stayful site, in the extension&apos;s own storage. Nothing else is stored locally.</p>

      <h2 className="mt-8 text-lg font-bold">Disconnecting</h2>
      <p className="mt-2 text-sm text-[#5a6356]">
        Click the Stayful icon in your toolbar and choose Disconnect, or revoke any connection on <Link href="/extension/connect" className="underline">the connect page</Link>. Revoked tokens stop working immediately. Uninstalling the extension removes its local storage.
      </p>

      <p className="mt-10 text-xs text-[#7a8274]">
        Questions: <a href="mailto:hello@stayful.co.uk" className="underline">hello@stayful.co.uk</a>. This page supplements the Stayful privacy policy.
      </p>
    </section>
  );
}
