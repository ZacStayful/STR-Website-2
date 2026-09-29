"use client";

import type { SampleDeal } from "@/lib/profile/server";

/**
 * One or two deals that match the answers so far, shown near the end of the
 * quiz: the unopened card, and nothing else — no address, no postcode, no
 * link. The figures are the area estimate at the member's own finance.
 */
export function SampleDeals({ deals }: { deals: SampleDeal[] }) {
  if (deals.length === 0) return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing on the market matches every answer just now. New deals arrive every morning.</p>;
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {deals.map((d) => (
        <li key={d.id} className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="relative aspect-[4/3] w-full bg-muted">
            {d.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.photoUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">{d.source === "zoopla" ? "Photo on the listing" : "Photo coming"}</div>
            )}
            <div className="absolute left-2 top-2 flex flex-wrap gap-1">
              <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">{d.kind === "rent" ? "Rent-to-rent" : "To buy"}</span>
              {d.tags.map((t) => (
                <span key={t} className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-lg font-bold text-foreground">{d.range ? d.range.split(" · ")[0] : d.figureBig}</p>
              {d.price && <p className="text-sm font-semibold text-foreground">{d.price}</p>}
            </div>
            <p className="text-xs text-muted-foreground">{d.range ? `${d.range.split(" · ")[1] ?? "area estimate"}, at your numbers` : d.figureSmall}</p>
            <p className="mt-1.5 truncate text-sm font-medium text-foreground">{d.where || "Location on the sheet"}</p>
            <p className="truncate text-xs text-muted-foreground">{d.type}</p>
            <p className={"mt-2 text-[11px] " + (d.freshnessKind === "live" ? "text-primary" : "text-muted-foreground")}>{d.freshness}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
