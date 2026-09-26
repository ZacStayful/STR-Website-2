import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { personName, profileNames } from "@/lib/team";
import { pipelineStatusInfo } from "@/lib/listing/pipeline";
import { countsLine, groupByStage, matchesFocus, stageCounts, type ViewerDeal } from "@/lib/listing/tracked";
import { loadTrackedDeals } from "@/lib/listing/tracked-server";
import { myDealsFocusPath } from "@/lib/listing/return-path";
import { DealRow } from "./_components/DealRow";
import { FocusScroll } from "./_components/FocusScroll";
import { ReportsList } from "./_components/ReportsList";

export const metadata: Metadata = {
  title: "My deals — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const MESSAGES: Record<string, string> = {
  opened: "Opened. The address and the listing link are on the deal, and it has moved to the stage you chose.",
};

/**
 * Every deal a member is working on, grouped by how far along it is: Kept,
 * Contacted, Viewing, Offer, Secured, then Passed (collapsed). Today is for
 * new deals; this is for deals in hand. The second tab is the saved reports
 * list that used to live at /reports.
 *
 * For a team, the rule is Team reports' rule: the owner and every active
 * member see every deal anyone on the team tracks, labelled by person, and
 * change only their own. See src/lib/listing/tracked-server.ts.
 */
export default async function MyDealsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; focus?: string; msg?: string }> }) {
  const { tab, q, focus, msg } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const adminUser = isAdminEmail(user.email);
  const now = new Date();
  const reportsTab = tab === "reports";

  const [load, settings] = await Promise.all([loadTrackedDeals(user.id, { scope: "team", adminUser }), getBillingSettings()]);
  const team = load.people.length > 1;
  const names = team ? await profileNames(load.people) : new Map();
  const nameOf = (id: string) => (id === user.id ? "You" : personName(names.get(id)));

  // A linked report counts only while it still exists (and is one this
  // person may read: saved_searches' RLS is the Team reports rule).
  const linked = [...new Set(load.view.map((v) => v.reportId).filter((id): id is string => Boolean(id)))];
  const existing = new Set<string>();
  if (linked.length > 0) {
    const { data } = await supabase.from("saved_searches").select("id").in("id", linked);
    for (const r of (data ?? []) as { id: string }[]) existing.add(r.id);
  }
  const view: ViewerDeal[] = load.view.map((v) => (v.reportId && !existing.has(v.reportId) ? { ...v, reportId: null, reportUserId: null } : v));
  const shownOnDeals = new Set(view.map((v) => v.reportId).filter((id): id is string => Boolean(id)));

  const counts = stageCounts(view);
  const line = countsLine(counts);
  const groups = groupByStage(view);
  const active = groups.filter((g) => g.stage !== "passed" && g.items.length > 0);
  const passed = groups.find((g) => g.stage === "passed")!;
  const focusItem = focus ? view.find((v) => matchesFocus(v, focus)) ?? null : null;
  const message = msg ? MESSAGES[msg] ?? null : null;

  const row = (item: ViewerDeal) => (
    <DealRow
      key={item.key}
      item={item}
      card={item.dealId ? load.cards.get(item.dealId) ?? null : null}
      address={item.dealId ? load.addresses.get(item.dealId) ?? null : null}
      ladder={settings.dealOpenLadder}
      adminUser={adminUser}
      now={now}
      focused={focusItem?.key === item.key}
      personName={nameOf}
      reportAction={
        item.reportId ? (
          <Link href={`/reports/${item.reportId}?back=${encodeURIComponent(myDealsFocusPath(item.key))}`} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
            Open full report{item.reportUserId ? ` · ${nameOf(item.reportUserId)}’s` : ""}
          </Link>
        ) : null
      }
    />
  );

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:py-8">
        <header>
          <h1 className="text-2xl font-bold text-foreground">My deals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {line || (team ? "Every deal your team is working on, by how far along it is." : "Every deal you’re working on, by how far along it is.")}
          </p>
        </header>

        <nav aria-label="My deals" className="flex gap-1 border-b border-border text-sm">
          <Tab href="/my-deals" current={!reportsTab}>
            Deals{view.length ? ` · ${view.length}` : ""}
          </Tab>
          <Tab href="/my-deals?tab=reports" current={reportsTab}>
            Reports
          </Tab>
        </nav>

        {message && !reportsTab && <p className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-foreground">{message}</p>}

        {reportsTab ? (
          <ReportsList userId={user.id} showAuthors={team} q={q} shownOnDeals={shownOnDeals} />
        ) : view.length === 0 ? (
          <section className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium text-foreground">Nothing here yet. Keep deals from Today to start your list.</p>
            <Link href="/today" className="mt-3 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Go to Today
            </Link>
          </section>
        ) : (
          <div className="space-y-6">
            {active.map((g) => (
              <section key={g.stage} aria-labelledby={`stage-${g.stage}`}>
                <h2 id={`stage-${g.stage}`} className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: pipelineStatusInfo(g.stage).colour }} aria-hidden="true" />
                  {pipelineStatusInfo(g.stage).label} · {g.items.length}
                </h2>
                <ul className="space-y-3">{g.items.map(row)}</ul>
              </section>
            ))}
            {active.length === 0 && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Everything here is passed. Keep deals from <Link href="/today" className="font-medium text-foreground underline-offset-4 hover:underline">Today</Link> to start again.</p>}
            {passed.items.length > 0 && (
              <details className="group rounded-xl border border-border bg-card/50" open={focusItem?.stage === "passed" || undefined}>
                <summary className="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Passed · {passed.items.length}</summary>
                <ul className="space-y-3 p-3 pt-0">{passed.items.map(row)}</ul>
              </details>
            )}
          </div>
        )}
        <FocusScroll targetId={reportsTab ? null : focusItem?.key ?? null} />
      </div>
    </main>
  );
}

function Tab({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={"-mb-px border-b-2 px-3 py-2 font-medium " + (current ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
      {children}
    </Link>
  );
}
