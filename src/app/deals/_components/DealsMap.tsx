"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useUkGeo, MAP_W, MAP_H } from "@/app/markets/_components/useUkGeo";
import { areaMetaForCode } from "@/lib/market/areas";
import { buildBuckets, bucketIndex, spreadPalette } from "@/lib/market/buckets";
import { filtersToSearch, type DealFilters } from "@/lib/marketplace/grid";

const SAGE = ["#cdd8c4", "#a2b299", "#6e8467", "#3a5634"];
const NO_DATA = "#e8e8e2";

/**
 * The UK by postcode area, shaded by how many live deals each holds. Clicking
 * an area toggles it in the filter and re-queries the grid. No pins: exact
 * locations are what a member pays for.
 */
export function DealsMap({ counts, filters }: { counts: Record<string, number>; filters: DealFilters }) {
  const router = useRouter();
  const { paths, failed } = useUkGeo();
  const [hover, setHover] = useState<string | null>(null);
  const scale = useMemo(() => {
    const values = Object.values(counts).filter((n) => n > 0);
    if (values.length === 0) return null;
    const buckets = buildBuckets(values, 1, (v) => String(Math.round(v)));
    return { ...buckets, colours: spreadPalette(SAGE, buckets.thresholds.length + 1) };
  }, [counts]);
  const fillFor = (code: string) => {
    const n = counts[code] ?? 0;
    if (!scale || n <= 0) return NO_DATA;
    return scale.colours[bucketIndex(n, scale.thresholds)];
  };
  const toggle = (code: string) => {
    const areas = filters.areas.includes(code) ? filters.areas.filter((c) => c !== code) : [...filters.areas, code];
    router.push(`/deals${filtersToSearch({ ...filters, areas, page: 1 })}`);
  };
  if (failed) return <div className="rounded-xl border border-border bg-muted p-6 text-center text-xs text-muted-foreground">Map unavailable</div>;
  const hovered = hover ? { name: areaMetaForCode(hover).name, n: counts[hover] ?? 0 } : null;
  return (
    <div className="relative rounded-xl border border-border bg-[#f2f4ee] p-2">
      {hovered && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground shadow-sm">
          {hovered.name} · {hovered.n} deal{hovered.n === 1 ? "" : "s"}
        </div>
      )}
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Live deals by postcode area" className="h-auto w-full max-h-[70vh]">
        {paths.map((p) => {
          const selected = filters.areas.includes(p.area);
          const clickable = (counts[p.area] ?? 0) > 0;
          return (
            <path
              key={p.area}
              d={p.d}
              fill={hover === p.area && clickable ? "#5d8156" : fillFor(p.area)}
              stroke={selected ? "#2e3d2b" : "#ffffff"}
              strokeWidth={selected ? 1.6 : 0.5}
              style={{ cursor: clickable ? "pointer" : "default" }}
              onMouseEnter={() => setHover(p.area)}
              onMouseLeave={() => setHover((h) => (h === p.area ? null : h))}
              onClick={() => clickable && toggle(p.area)}
            >
              <title>{`${areaMetaForCode(p.area).name}: ${counts[p.area] ?? 0} live deals`}</title>
            </path>
          );
        })}
      </svg>
      {scale && (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-1 text-[11px] text-muted-foreground">
          <span>Fewer</span>
          {scale.colours.map((c) => (
            <span key={c} className="inline-block h-3 w-6 rounded-sm" style={{ background: c }} />
          ))}
          <span>More deals · click an area to filter</span>
        </div>
      )}
    </div>
  );
}
