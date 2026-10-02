"use client";

import { readableOn } from "@/lib/funnels/brand";

/**
 * Batch 22f: what a landlord sees, live as the company, logo and colour
 * change — the top of the form and the report's headline, with demo figures.
 */
export function BrandPreview({ companyName, logoUrl, primary }: { companyName: string; logoUrl: string | null; primary: string | null }) {
  const colour = primary && /^#[0-9a-f]{6}$/i.test(primary) ? primary : "#2E3D2B";
  const fg = readableOn(colour);
  const name = companyName.trim() || "Your company";
  return (
    <div aria-label="Preview of your form" className="overflow-hidden rounded-xl border border-border bg-white text-[#1f2a1d] shadow-sm">
      <div className="flex items-center gap-3 border-b border-[#e5e3da] px-4 py-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={name} className="h-8 max-w-[140px] object-contain" />
        ) : (
          <span className="text-sm font-semibold">{name}</span>
        )}
      </div>
      <div className="px-4 py-5">
        <p className="text-base font-semibold">What could your property earn as a short-term let?</p>
        <p className="mt-1 text-xs text-[#6b7280]">A free income report from {name}, in about a minute.</p>
        <div className="mt-3 rounded-md border border-[#e5e3da] px-3 py-2 text-xs text-[#9ca3af]">Start typing your address…</div>
        <span className="mt-3 inline-block rounded-md px-4 py-2 text-sm font-semibold" style={{ background: colour, color: fg }}>
          Get my report
        </span>
        <div className="mt-5 rounded-lg p-3" style={{ background: `${colour}14` }}>
          <p className="text-[11px] uppercase tracking-wide text-[#6b7280]">Sample report · demo data</p>
          <p className="mt-1 text-xl font-semibold" style={{ color: colour }}>£41,364 a year</p>
          <p className="text-xs text-[#4b5563]">2-bed flat, Manchester M4 · 61% occupancy · £177 a night</p>
        </div>
      </div>
    </div>
  );
}
