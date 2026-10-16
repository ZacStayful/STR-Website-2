"use client";

import { useEffect, useMemo, useState } from "react";
import { regionForArea } from "@/lib/market/regions";
import { sortBtlDistricts, type BtlDistrictRow, type BtlDistrictSort } from "@/lib/btl/explorer";

const SORTS: { key: BtlDistrictSort; label: string }[] = [
  { key: "yield", label: "Gross yield" },
  { key: "growth5y", label: "5-year growth" },
  { key: "growth1y", label: "1-year growth" },
  { key: "price", label: "Average price" },
  { key: "cash", label: "Typical cash in" },
];

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;

/**
 * Batch 28, Part H: the Explorer's "Buy to let" view. Districts from the
 * cached key stats (GET /api/explorer/btl, read once when switched on):
 * gross yield, 5-year and 1-year growth, average price and the typical cash
 * in. Growth is history, not a forecast; a district with no yield says
 * "Not enough data".
 */
export function BtlDistrictsPane({ region, q }: { region: string | null; q: string }) {
  const [rows, setRows] = useState<BtlDistrictRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<BtlDistrictSort>("yield");
  useEffect(() => {
    let live = true;
    fetch("/api/explorer/btl")
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { rows?: BtlDistrictRow[]; error?: string };
        if (!live) return;
        if (res.ok && data.rows) setRows(data.rows);
        else setError(data.error ?? "The district figures aren’t available just now.");
      })
      .catch(() => live && setError("We couldn’t reach the server. Please try again."));
    return () => {
      live = false;
    };
  }, []);
  const term = q.trim().toUpperCase();
  const shown = useMemo(() => {
    if (!rows) return [];
    const inScope = rows.filter((r) => (!region || (r.area && regionForArea(r.area).slug === region)) && (!term || r.outcode.startsWith(term) || r.area === term));
    return sortBtlDistricts(inScope, sort);
  }, [rows, region, term, sort]);

  if (error) return <div className="mx-empty"><h2>Buy to let</h2><p>{error}</p></div>;
  if (!rows) return <div className="mx-empty"><p>Loading the districts…</p></div>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{shown.length} district{shown.length === 1 ? "" : "s"} · long-term lets, from the area’s own figures. Growth is history, not a forecast.</span>
        <label>
          Sort by{" "}
          <select className="mx2-select mx2-select--inline" value={sort} onChange={(e) => setSort(e.target.value as BtlDistrictSort)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <div className="mx-empty"><h2>No districts</h2><p>Try another region or search.</p></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">District</th>
                <th className="py-1 pr-3 font-medium">Gross yield</th>
                <th className="py-1 pr-3 font-medium">5-year growth</th>
                <th className="py-1 pr-3 font-medium">1-year growth</th>
                <th className="py-1 pr-3 font-medium">Average price</th>
                <th className="py-1 font-medium">Typical cash in</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 300).map((r) => (
                <tr key={r.outcode} className="border-t border-border/60">
                  <td className="py-1 pr-3 font-semibold text-foreground">{r.outcode}</td>
                  {r.enough ? (
                    <>
                      <td className="py-1 pr-3">{r.grossYieldPct !== null ? `${r.grossYieldPct.toFixed(1)}%` : "—"}</td>
                      <td className="py-1 pr-3">{r.growth5yPct !== null ? pct(r.growth5yPct) : "—"}</td>
                      <td className="py-1 pr-3">{r.growth1yPct !== null ? pct(r.growth1yPct) : "—"}</td>
                      <td className="py-1 pr-3">{r.avgPrice !== null ? gbp(r.avgPrice) : "—"}</td>
                      <td className="py-1">{r.cashIn !== null ? gbp(r.cashIn) : "—"}</td>
                    </>
                  ) : (
                    <td className="py-1 text-muted-foreground" colSpan={5}>Not enough data</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 300 && <p className="mt-2 text-xs text-muted-foreground">Showing the first 300: pick a region or search to narrow it.</p>}
        </div>
      )}
    </div>
  );
}
