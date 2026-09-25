import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { areaMetaForCode } from "@/lib/market/areas";
import { listOpened } from "@/lib/marketplace/open";
import { formatOpenPrice } from "@/lib/marketplace/ladder";
import { headlineFigure, priceLine } from "../_components/DealCard";

export const metadata: Metadata = { title: "Opened deals — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const REASONS: Record<string, string> = {
  sold: "sold",
  under_offer: "under offer",
  let_agreed: "let agreed",
  removed: "no longer listed",
  unqualified: "no longer clears the bar",
  unsuitable: "cannot be short let",
  stale_listed: "listed too long",
  stale_unseen: "not seen for weeks",
  unverifiable: "could not be checked",
  admin: "removed by Stayful",
};

/** Every deal the member has opened, live or gone. An open is forever. */
export default async function OpenedDealsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const rows = await listOpened(user.id);
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <p className="mb-3 text-xs"><Link href="/deals" className="text-muted-foreground hover:underline">← All deals</Link></p>
        <h1 className="text-2xl font-bold text-foreground">My opened deals</h1>
        <p className="mt-1 text-sm text-muted-foreground">Everything you have paid to open, including your daily picks. A deal stays yours after it leaves the market.</p>
        {rows.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium text-foreground">Nothing opened yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">Open a deal from the grid and it will appear here.</p>
          </div>
        ) : (
          <ul className="mt-6 space-y-2">
            {rows.map(({ open, deal }) => {
              const area = deal?.postcode_area ? areaMetaForCode(deal.postcode_area) : null;
              const fig = deal ? headlineFigure(deal) : null;
              const gone = deal?.status === "retired";
              return (
                <li key={open.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/deals/${open.deal_id}`} className="text-sm font-semibold text-foreground hover:underline">
                        {deal ? [deal.town, area?.name && area.name !== deal.town ? area.name : null, deal.outcode].filter(Boolean).join(" · ") : "Deal"}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {[deal ? (deal.kind === "rent" ? "Rent-to-rent" : "To buy") : null, deal?.bedrooms ? `${deal.bedrooms} bed` : null, deal ? priceLine(deal) : null, fig ? `${fig.big} ${fig.small}` : null].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      {gone ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">Gone off market{deal?.retired_reason ? ` · ${REASONS[deal.retired_reason] ?? deal.retired_reason}` : ""}{deal?.retired_at ? ` · ${new Date(deal.retired_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span>
                      ) : (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">Live</span>
                      )}
                      <p className="mt-1 text-muted-foreground">Opened {new Date(open.opened_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{Number(open.charged_base_pence) > 0 ? ` · ${formatOpenPrice(Number(open.charged_base_pence))}` : " · free"}{open.verified_via === "pick" ? " · daily pick" : ""}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
