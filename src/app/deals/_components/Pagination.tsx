import Link from "next/link";
import { filtersToSearch, PAGE_SIZE, type DealFilters } from "@/lib/marketplace/grid";

export function Pagination({ filters, total, pages }: { filters: DealFilters; total: number; pages: number }) {
  if (pages <= 1) return null;
  const page = Math.min(filters.page, pages);
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const link = (p: number) => `/deals${filtersToSearch({ ...filters, page: p })}`;
  const btn = "rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted";
  return (
    <nav className="mt-6 flex items-center justify-between gap-3 text-sm" aria-label="Pages">
      <span className="text-xs text-muted-foreground">{from.toLocaleString("en-GB")}–{to.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link href={link(page - 1)} className={btn}>Previous</Link> : <span className={btn + " opacity-40"}>Previous</span>}
        <span className="px-2 py-1.5 text-xs text-muted-foreground">Page {page} of {pages}</span>
        {page < pages ? <Link href={link(page + 1)} className={btn}>Next</Link> : <span className={btn + " opacity-40"}>Next</span>}
      </div>
    </nav>
  );
}
