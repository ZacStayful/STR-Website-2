import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileNames, personName } from "@/lib/team";
import { deleteReportAction } from "@/app/reports/actions";

interface Row {
  user_id: string;
  id: string;
  address: string;
  postcode: string | null;
  bedrooms: number | null;
  kind: string | null;
  created_at: string;
  revenue: number | string | null;
  fit: string | null;
  source: string | null;
  source_url: string | null;
  deal_kind: string | null;
  deal_yield: number | string | null;
  deal_margin: number | string | null;
}

const SOURCE_LABEL: Record<string, string> = { rightmove: "Rightmove", onthemarket: "OnTheMarket", zoopla: "Zoopla", airbnb: "Airbnb", booking: "Booking.com" };

function gbp(v: number | string | null): string {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `£${Math.round(n).toLocaleString("en-GB")}` : "—";
}

/**
 * The saved reports list (what /reports showed): every analysis the member
 * ran, or for a team every analysis anyone on it ran. Which rows come back is
 * decided by RLS on saved_searches — their own, plus the team's for an owner
 * or an active member — so a member keeps the reports they ran before joining
 * and a paused member sees only their own until their seat is back.
 *
 * A report already shown on one of their deals (`shownOnDeals`) is left out
 * here, so it appears once, on the deal, except in a search: someone
 * searching for an address (or following an old /reports?q= link) finds it.
 */
export async function ReportsList({ userId, showAuthors, q, shownOnDeals }: { userId: string; showAuthors: boolean; q: string | undefined; shownOnDeals: Set<string> }) {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("saved_searches")
    .select(
      "id, user_id, address, postcode, bedrooms, kind, created_at, revenue:result->shortLet->annualRevenue, fit:result->verdict->>fit, source:source_listing->>source, source_url:source_listing->>url, deal_kind:deal->>kind, deal_yield:deal->>grossYieldPct, deal_margin:deal->>monthlyMargin",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  const term = q?.trim();
  if (term) query = query.or(`address.ilike.%${term.replace(/[%,()]/g, "")}%,postcode.ilike.%${term.replace(/[%,()]/g, "")}%`);
  const { data, error } = await query;
  const all = (error ? [] : (data ?? [])) as unknown as Row[];
  const rows = term ? all : all.filter((r) => !shownOnDeals.has(r.id));
  const onDeals = all.length - rows.length;
  const authors = showAuthors ? await profileNames([...new Set(rows.map((r) => r.user_id))]) : new Map();

  return (
    <section aria-labelledby="reports-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="reports-heading" className="text-lg font-semibold text-foreground">{showAuthors ? "Team reports" : "My reports"}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {showAuthors ? "Every analysis anyone on your team has run, ready to reopen." : "Every analysis you have run, ready to reopen."} Reopening never uses a run.
            {onDeals > 0 ? ` Reports on your deals are on the deal itself.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/picks" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
            Daily picks
          </Link>
          <Link href="/estimate" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            New analysis
          </Link>
        </div>
      </div>

      <form className="mb-4 flex gap-2" action="/my-deals" method="get">
        <input type="hidden" name="tab" value="reports" />
        <input name="q" defaultValue={term ?? ""} placeholder="Search by address or postcode" className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-sm" />
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
          Search
        </button>
      </form>

      {error && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Could not load your reports right now.</p>}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm font-medium text-foreground">{term ? "No reports match that search." : onDeals > 0 ? "Every report you have is on one of your deals." : "No reports yet."}</p>
          <p className="mt-1 text-xs text-muted-foreground">Run an analysis, or paste a Rightmove, OnTheMarket or Airbnb link on the analyser, and it will appear here.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/reports/${r.id}`} className="block truncate text-sm font-semibold text-foreground hover:underline">
                  {r.address}
                </Link>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span>{new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  {showAuthors ? <span>· by {r.user_id === userId ? "you" : personName(authors.get(r.user_id))}</span> : null}
                  {r.postcode && <span>· {r.postcode}</span>}
                  {r.bedrooms !== null && <span>· {r.bedrooms} bed</span>}
                  {r.source && (
                    <span>
                      ·{" "}
                      {r.source_url ? (
                        <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {SOURCE_LABEL[r.source] ?? r.source}
                        </a>
                      ) : (
                        SOURCE_LABEL[r.source] ?? r.source
                      )}
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-foreground">{gbp(r.revenue)}<span className="text-xs font-normal text-muted-foreground"> / yr</span></p>
                <p className="text-xs text-muted-foreground">
                  {r.deal_kind === "rent-to-rent" && r.deal_margin !== null ? `${Number(r.deal_margin) < 0 ? "−" : ""}${gbp(Math.abs(Number(r.deal_margin)))} / mo margin` : r.deal_kind === "purchase" && r.deal_yield !== null ? `${r.deal_yield}% yield` : r.fit ? `${r.fit} fit` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/reports/${r.id}`} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                  Open
                </Link>
                <form action={deleteReportAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-destructive" aria-label={`Delete report for ${r.address}`}>
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
