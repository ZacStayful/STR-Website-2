import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { payerFor } from "@/lib/team";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { parseDealFilters } from "@/lib/marketplace/grid";
import { listDeals, liveCountsByArea, recordShown, photoUrlFor, openedDealIds, countFor } from "@/lib/marketplace/queries";
import { DealCard } from "./_components/DealCard";
import { DealsFilterBar } from "./_components/DealsFilterBar";
import { DealsMap } from "./_components/DealsMap";
import { Pagination } from "./_components/Pagination";

export const metadata: Metadata = {
  title: "Deals — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const MESSAGES: Record<string, string> = {
  gone: "That deal has gone off the market.",
  missing: "We could not find that deal.",
};

/**
 * The marketplace grid: every live deal that clears the income screening,
 * with the figures free to see and the address behind a paid open. Filters
 * live in the URL; the server re-queries on every change.
 */
export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const filters = parseDealFilters(raw);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [page, counts, settings] = await Promise.all([listDeals(filters), liveCountsByArea(), getBillingSettings()]);
  const opened = await openedDealIds((await payerFor(user.id)).payerId, page.cards.map((c) => c.id));
  const now = new Date();
  const countMap: Record<string, number> = {};
  for (const c of counts) countMap[c.code] = countFor(counts, c.code, filters.kind);
  const message = typeof raw.msg === "string" ? MESSAGES[raw.msg] ?? null : null;
  const totalLive = counts.reduce((n, c) => n + c.total, 0);

  // What this member was shown goes to the front of the recheck queue.
  const shownIds = page.cards.map((c) => c.id);
  after(() => recordShown(shownIds));

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Deals</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every listing on the market in Stayful’s top areas that nets at least 40% more as a short let than a long let, or £8,000 a year after rent. Figures are free; open a deal for the address, photos and listing link.
            </p>
          </div>
          <Link href="/deals/opened" className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">My opened deals</Link>
        </div>

        {message && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{message}</p>}

        <DealsFilterBar filters={filters} counts={counts} total={page.total} />

        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            {page.cards.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <p className="text-sm font-medium text-foreground">{totalLive === 0 ? "The marketplace is filling up." : "Nothing matches that filter yet."}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {totalLive === 0 ? "The first sweep runs each morning and new deals go live once we have checked their listing page. Check back tomorrow." : "Try a wider price range, another area, or drop the profit floor. New deals arrive every morning."}
                </p>
              </div>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {page.cards.map((card) => (
                  <DealCard key={card.id} card={card} photoUrl={photoUrlFor(card, now)} ladder={settings.dealOpenLadder} now={now} opened={opened.has(card.id)} />
                ))}
              </ul>
            )}
            <Pagination filters={filters} total={page.total} pages={page.pages} />
          </section>
          <aside className="order-first lg:order-none">
            <DealsMap counts={countMap} filters={filters} />
            <p className="mt-2 text-[11px] text-muted-foreground">Prices and rents are the listing’s own. Short-let income is Stayful’s estimate for the area and size; long-let figures come from our own reports or a national table where marked. Nothing here is a guarantee.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
