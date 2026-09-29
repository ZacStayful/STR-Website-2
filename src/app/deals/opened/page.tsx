import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { payerFor } from "@/lib/team";
import { areaMetaForCode } from "@/lib/market/areas";
import { listOpened } from "@/lib/marketplace/open";
import { priceLine } from "../_components/DealCard";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { formatPence } from "@/lib/credit/deal-pricing";
import { parseMarketGoals } from "@/lib/market/goals";
import { rangeCaption, rangeFromScreening } from "@/lib/marketplace/profit-range";
import { checkOf } from "@/lib/deal-quality/checks";

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
  const [rows, settings, profileRes] = await Promise.all([listOpened((await payerFor(user.id)).payerId), getBillingSettings(), supabase.from("profiles").select("market_goals").eq("id", user.id).maybeSingle()]);
  const finance = parseMarketGoals(profileRes.data?.market_goals)?.finance ?? null;
  // What each open actually took from the balance (top-up credit at its rate), not its plan price.
  const paid = new Map<number, number>();
  const txIds = rows.filter((r) => Number(r.open.charged_base_pence) > 0).map((r) => r.open.transaction_id).filter((t): t is number => typeof t === "number");
  if (txIds.length > 0 && hasServiceRole()) {
    const { data } = await createAdminClient().from("credit_transactions").select("id, amount_pence").in("id", txIds.slice(0, 500));
    for (const t of (data ?? []) as { id: number; amount_pence: number | string }[]) paid.set(Number(t.id), Math.abs(Number(t.amount_pence) || 0));
  }
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <p className="mb-3 text-xs"><Link href="/deals" className="text-muted-foreground hover:underline">← All deals</Link></p>
        <h1 className="text-2xl font-bold text-foreground">My opened deals</h1>
        <p className="mt-1 text-sm text-muted-foreground">Everything you have opened, including your daily picks. A deal stays yours after it leaves the market. Profit is an area estimate at your finance; a Full analysis gives the exact figures.</p>
        {rows.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium text-foreground">Nothing opened yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">Open a deal from the grid and it will appear here.</p>
          </div>
        ) : (
          <ul className="mt-6 space-y-2">
            {rows.map(({ open, deal }) => {
              const area = deal?.postcode_area ? areaMetaForCode(deal.postcode_area) : null;
              const range = deal ? rangeFromScreening(deal, finance, settings.dealPricing.profitRangePct) : null;
              // What the open itself cost. The daily pick under daily deals is linked to that day's charge but cost nothing itself: "included".
              const paidPence = open.transaction_id !== null && Number(open.charged_base_pence) > 0 ? paid.get(Number(open.transaction_id)) ?? null : null;
              const gone = deal?.status === "retired";
              return (
                <li key={open.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/deals/${open.deal_id}`} className="text-sm font-semibold text-foreground hover:underline">
                        {deal ? [deal.town, area?.name && area.name !== deal.town ? area.name : null, deal.outcode].filter(Boolean).join(" · ") : "Deal"}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {[deal ? (deal.kind === "rent" ? "Rent-to-rent" : "To buy") : null, deal?.bedrooms ? `${deal.bedrooms} bed` : null, deal ? priceLine(deal) : null, range ? `${range.label} ${rangeCaption(deal ? checkOf(deal.screening)?.compCount : null)}` : null].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      {gone ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">Gone off market{deal?.retired_reason ? ` · ${REASONS[deal.retired_reason] ?? deal.retired_reason}` : ""}{deal?.retired_at ? ` · ${new Date(deal.retired_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span>
                      ) : (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">Live</span>
                      )}
                      <p className="mt-1 text-muted-foreground">Opened {new Date(open.opened_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{paidPence !== null && paidPence > 0 ? ` · ${formatPence(paidPence)}` : Number(open.charged_base_pence) > 0 ? "" : open.verified_via === "pick" ? " · included" : " · free"}{open.verified_via === "pick" ? " · daily pick" : ""}</p>
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
