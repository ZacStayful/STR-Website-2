"use client";

import { useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Batch 26: today's picks side by side in one row you swipe (one card tall
 * on a phone), with arrows on a desktop for a mouse. The cards are the
 * server's (Today's own DealCard).
 */
export function PicksRow({ cards }: { cards: { label: string; node: ReactNode }[] }) {
  const row = useRef<HTMLDivElement>(null);
  const by = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.6, behavior: "smooth" });
  return (
    <div className="relative">
      <div ref={row} className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1" aria-label="Today’s picks">
        {cards.map((c, i) => (
          <section key={i} aria-label={c.label} className="w-[86%] max-w-[440px] shrink-0 snap-start sm:w-[calc(50%-6px)]">
            <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[#B9D5C6]">
              {c.label}
              {cards.length > 1 && <span className="font-normal normal-case tracking-normal text-[#B9D5C6]/80"> · {i + 1} of {cards.length}</span>}
            </h2>
            <div className="rounded-2xl bg-background text-foreground">{c.node}</div>
          </section>
        ))}
      </div>
      {cards.length > 2 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 justify-between sm:flex">
          <button type="button" aria-label="Previous pick" onClick={() => by(-1)} className="pointer-events-auto -ml-5 flex size-9 items-center justify-center rounded-full bg-[#2E3D2B]/90 text-white shadow ring-1 ring-white/20 hover:bg-[#2E3D2B]">
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button type="button" aria-label="Next pick" onClick={() => by(1)} className="pointer-events-auto -mr-5 flex size-9 items-center justify-center rounded-full bg-[#2E3D2B]/90 text-white shadow ring-1 ring-white/20 hover:bg-[#2E3D2B]">
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
