import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { personName, profileNames } from "@/lib/team";
import { pipelineStatusInfo } from "@/lib/listing/pipeline";
import { countsLine, groupByStage, matchesFocus, stageCounts, type ViewerDeal } from "@/lib/listing/tracked";
import { loadTrackedDeals } from "@/lib/listing/tracked-server";
import { myDealsFocusPath } from "@/lib/listing/return-path";
import { myDealsShowsPassed } from "@/lib/nav";
import { DealRow } from "./_components/DealRow";
import { cardStatesFor } from "@/lib/marketplace/card-state";
import { cardView, NOT_OPENED } from "@/lib/marketplace/card-view";
import { cashBuyerOf } from "@/lib/marketplace/most-you-can-pay";
import { quoterFor } from "@/lib/credit/quote-server";
import { dealVisibilityFor } from "@/lib/marketplace/tier";
import { dealVisibleTo } from "@/lib/marketplace/visibility";
import { parseMarketGoals } from "@/lib/market/goals";
import { FocusScroll } from "./_components/FocusScroll";
import { ReportsList } from "./_components/ReportsList";
import { profilesFor } from "@/lib/profiles/server";
import { profileTagsFor } from "@/lib/profiles/deal-tags";
import { labelsShown, profileLabel } from "@/lib/profiles/rules";

export const metadata: Metadata = {
  title: "My deals — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const MESSAGES: Record<string, string> = {
  opened: "Opened. The address and the listing link are on the deal, and it has moved to the stage you chose.",
  stage_failed: "Opened, but we couldn’t move it to that stage just now. Choose it again below.",
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
export default async function MyDealsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; focus?: string; msg?: string; show?: string | string[]; profile?: string }> }) {
  const { tab, q, focus, msg, show, profile: profileParam } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/my-deals");
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
  for (let i = 0; i < linked.length; i += 150) {
    const { data } = await supabase.from("saved_searches").select("id").in("id", linked.slice(i, i + 150));
    for (const r of (data ?? []) as { id: string }[]) existing.add(r.id);
  }
  const everything: ViewerDeal[] = load.view.map((v) => (v.reportId && !existing.has(v.reportId) ? { ...v, reportId: null, reportUserId: null } : v));

  // Saved profiles (Batch 13): which of the member's own profiles each deal is
  // for, and ?profile=<id> to see one profile's deals (a sourcer's one client).
  const [saved, tags] = await Promise.all([profilesFor(user.id), profileTagsFor(user.id, load.payerId, everything)]);
  const byId = new Map(saved.all.map((p) => [p.id, p]));
  const showProfiles = saved.readable && labelsShown(saved.all);
  const taggedIds = new Set(tags.values());
  const filterProfiles = saved.all.filter((p) => !p.deletedAt || taggedIds.has(p.id));
  const profileFilter = showProfiles && profileParam && byId.has(profileParam) ? profileParam : null;
  const view: ViewerDeal[] = profileFilter ? everything.filter((v) => tags.get(v.key) === profileFilter) : everything;
  const profileNameOf = (item: ViewerDeal): string | null => {
    if (!showProfiles) return null;
    const p = byId.get(tags.get(item.key) ?? "");
    return p ? profileLabel(p) : null;
  };
  const shownOnDeals = new Set(view.map((v) => v.reportId).filter((id): id is string => Boolean(id)));

  // Batch 10: each marketplace deal's range at this member's finance, its
  // badges, and its prices at what they pay.
  const dealIds = [...new Set(view.map((v) => v.dealId).filter((id): id is string => Boolean(id)))];
  const [states, quoter, profileRes, visibility] = await Promise.all([cardStatesFor(supabase, user.id, load.payerId, dealIds), quoterFor(load.payerId, adminUser), supabase.from("profiles").select("market_goals").eq("id", user.id).maybeSingle(), dealVisibilityFor(user.id, adminUser)]);
  const activeGoals = parseMarketGoals(profileRes.data?.market_goals);
  const activeFinance = activeGoals?.finance ?? null;
  const viewFor = (item: ViewerDeal) => {
    const c = item.dealId ? load.cards.get(item.dealId) ?? null : null;
    if (!c) return null;
    // A deal kept for a profile is priced at that profile's finance; untagged ones at the active profile's.
    const own = byId.get(tags.get(item.key) ?? "");
    const finance = own && !own.isActive ? own.goals?.finance ?? activeFinance : activeFinance;
    const cashBuyer = cashBuyerOf(own && !own.isActive ? own.goals ?? activeGoals : activeGoals);
    const state = states.get(c.id) ?? NOT_OPENED;
    const opened = state.opened || item.opened;
    const v = cardView({ card: c, state: { ...state, opened, reportId: state.reportId ?? item.reportId }, admin: adminUser, pricing: settings.dealPricing, ladder: settings.dealOpenLadder, finance, cashBuyer, lowEntry: settings.lowEntry, label: quoter.label });
    // Still in its early-access window for this member: a kept deal that went
    // and came back (a revival restarts the window), or a team seat under an
    // owner who has never paid. Nothing on it can be bought yet.
    return !opened && !dealVisibleTo({ id: c.id, live_since: c.live_since }, visibility) ? { ...v, quickLook: null, fullAnalysis: null } : v;
  };

  const counts = stageCounts(view);
  const line = countsLine(counts);
  const groups = groupByStage(view);
  const active = groups.filter((g) => g.stage !== "passed" && g.items.length > 0);
  const passed = groups.find((g) => g.stage === "passed")!;
  const focusItem = focus ? view.find((v) => matchesFocus(v, focus)) ?? null : null;
  // ?show=passed (the old /deals?view=passed link, and the grid's "passed on every deal"): the Passed group open, and in view.
  const showPassed = !reportsTab && myDealsShowsPassed(show) && passed.items.length > 0;
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
      view={viewFor(item)}
      profileName={profileNameOf(item)}
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

        {showProfiles && !reportsTab && (
          <nav aria-label="Filter by profile" className="flex flex-wrap gap-2 text-sm">
            <ProfileChip href="/my-deals" current={!profileFilter}>All profiles</ProfileChip>
            {filterProfiles.map((p) => (
              <ProfileChip key={p.id} href={`/my-deals?profile=${encodeURIComponent(p.id)}`} current={profileFilter === p.id}>
                {profileLabel(p)}
              </ProfileChip>
            ))}
          </nav>
        )}

        {message && !reportsTab && <p className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-foreground">{message}</p>}

        {reportsTab ? (
          <ReportsList userId={user.id} showAuthors={team} q={q} shownOnDeals={shownOnDeals} />
        ) : view.length === 0 ? (
          <section className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium text-foreground">{profileFilter ? "Nothing kept for this profile yet. Switch to it and keep deals from its Today." : "Nothing here yet. Keep deals from Today to start your list."}</p>
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
              <details id="stage-passed" className="group scroll-mt-24 rounded-xl border border-border bg-card/50" open={focusItem?.stage === "passed" || showPassed || undefined}>
                <summary className="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Passed · {passed.items.length}</summary>
                <ul className="space-y-3 p-3 pt-0">{passed.items.map(row)}</ul>
              </details>
            )}
          </div>
        )}
        {/* Batch 22d: deals cleared with "Start again", restorable for 30 days. */}
        {!reportsTab && load.cleared > 0 && (
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/my-deals/cleared" className="font-medium text-foreground underline-offset-4 hover:underline">
              Cleared deals · {load.cleared}
            </Link>
          </p>
        )}
        <FocusScroll targetId={reportsTab ? null : (focusItem?.key ?? (showPassed ? "stage-passed" : null))} />
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

function ProfileChip({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={"rounded-full border px-3 py-1 " + (current ? "border-primary bg-primary/10 font-semibold text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
      {children}
    </Link>
  );
}
